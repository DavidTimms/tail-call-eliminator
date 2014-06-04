
// main entry point. Takes a Mozilla Parser AST, a source string,
// or a function, and returns the same type
function tailCallOptimise(input) {
	if (typeof(input) === "string" || typeof(input) === "function") {
		var ast = require("esprima").parse(input.toString());
		return require("escodegen").generate(mapTree(ast, {}));
	}
	return mapTree(input, {});
}

// functions for handling particular node types
var transforms = {
	FunctionDeclaration: function (node, context) {
		// the context object for the scope of the function 
		// inherits from the parent function
		var subContext = Object.create(context);
		subContext.scopeName = node.id ? node.id.name : null;
		subContext.params = node.params.map(pluck("name"));
		subContext.tempNames = subContext.params.map(prefix("_tco_temp_"));
		subContext.usedTempNames = [];
		subContext.localVars = [];
		var mapped = mapChildren(node, subContext);

		// if the function has been found to be tail recursive
		// then wrap the function body in a while loop
		if (subContext.isTailRecursive) {
			var funcBlock = mapped.body;

			// create an array of "undefined" identifiers
			var undefinedValues = 
				subContext.localVars.map(always(identifier("undefined")));

			// add assignments to undefined for local variables to reset them
			// at the beginning of the recursive call
			funcBlock.body = zipAssign(subContext.localVars, undefinedValues)
				.concat(funcBlock.body);

			// add a return statement at the end to break the loop
			var lastStatement = funcBlock.body[funcBlock.body.length - 1];
			if (lastStatement.type !== "ReturnStatement") {
				funcBlock.body.push({
					type: "ReturnStatement",
					argument: null
				});
			}

			// Build the AST for the wrapped function body
			mapped.body = {
				type: "BlockStatement",
				// add declarations of temp variables above the loop
				body: zipDeclare(subContext.usedTempNames)
					.concat([{
						type: "LabeledStatement",
						label: identifier("_tailCall_"),
						body: {
							type: "WhileStatement",
							test: literal(true),
							body: funcBlock
						}
					}])
			};
		}

		// add local variable declarations at the top of the scope
		mapped.body.body = 
			zipDeclare(subContext.localVars)
			.concat(mapped.body.body);
		return mapped;
	},
	// forward function expressions to the handler for function declarations
	// they can be treated in exactly the same way for optimisation
	FunctionExpression: function (node, context) {
		return transforms.FunctionDeclaration(node, context);
	},
	ReturnStatement: function (node, context) {
		// if the return is a tail call
		if (matchObject(node.argument, {
				type: "CallExpression", 
				callee: {name: context.scopeName}
			})) return convertTailCall(node, context);

		if (matchObject(node.argument, {type: "ConditionalExpression"}))
			return convertTernaryIf(node, context);

		return mapChildren(node, context);
	},
	// eliminate blocks with another block as their only member.
	// these are sometimes produced by the return statement replacement
	BlockStatement: function (node, context) {
		var blockBody = mapChildren(node.body, context);
		if (blockBody.length === 1 && blockBody[0].type === "BlockStatement") {
			blockBody = blockBody[0].body;
		}
		return mix(node, {
			body: blockBody
		});
	},
	// replace variable declarations with assignments
	// and add them to the context, to be hoisted
	VariableDeclaration: function (node, context) {
		var declaredVars = node.declarations.map(function (dec) {
			return dec.id.name;
		});

		context.localVars = context.localVars.concat(declaredVars);

		return {
			type: "ExpressionStatement",
			expression: {
				type: "SequenceExpression",
				expressions: node.declarations.map(function (dec) {
					return {
						type: "AssignmentExpression",
						operator: "=",
						left: dec.id,
						right: dec.init || identifier("undefined")
					}
				})
			}
		}
	},
	ForStatement: createMapAndUnwrapProperty("init"),
	ForInStatement: createMapAndUnwrapProperty("left"),
	ForOfStatement: createMapAndUnwrapProperty("left")
};

// create a function which converts the node's children and 
// unwraps the specified property from an expression statement to
// an expression. This is useful for for loop initialisation steps.
function createMapAndUnwrapProperty(property) {
	return function (node, context) {
		var mapped = mapChildren(node, context);
		if (mapped && mapped[property].type === "ExpressionStatement") {
			mapped[property] = mapped[property].expression;
		}
		return mapped;
	};
}

// replace the return statement with assignments to 
// clear all variables in the scope and continue to repeat
// the loop
function convertTailCall(node, context) {
	var assignments;
	var params = [], args = [], tempNames = [];
	context.isTailRecursive = true;

	eachPair(context.params, node.argument.arguments, 
		function (param, arg, i) {
			// ignore invariant parameters
			if (!matchObject(arg, identifier(param))) {
				params.push(param);
				args.push(arg);
				var tempName = context.tempNames[i];
				tempNames.push(tempName);

				// keep track of which temp variables have actual 
				// been used in the scope
				if (context.usedTempNames.indexOf(tempName) < 0) {
					context.usedTempNames.push(tempName);
				}
			}
	});

	if (params.length > 1) {
		assignments = zipAssign(tempNames, args)
			.concat(zipAssign(params, tempNames.map(identifier)));
	}
	else {
		assignments = zipAssign(params, args);
	}

	return {
		type: "BlockStatement",
		body: assignments.concat({
			type: "ContinueStatement",
			label: identifier("_tailCall_")
		})
	};
}

// Convert a statement of the form: 
// 		return (test ? consequent : alternate);
// to the form: 
//		if (test) return consequent; else return alternate;
// then call mapTree again to perform tail call optimisation
function convertTernaryIf(node, context) {
	var ternIf = node.argument;
	return mapTree({
		type: "IfStatement",
		test: ternIf.test,
		consequent: wrapWithReturn(ternIf.consequent),
		alternate: wrapWithReturn(ternIf.alternate)
	}, context);
}

function wrapWithReturn(expression) {
	return {
		type: "ReturnStatement",
		argument: expression
	}
}

// creates a list of assignments from an array of variable
// names and an optional array of assignment values
function zipAssign(vars, values) {
	if (!vars) return [];
	values = values || [];
	return vars.map(function (param, index) {
		return {
			type: "ExpressionStatement",
			expression: {
				type: "AssignmentExpression",
				operator: "=",
				left: identifier(param),
				right: values[index] || identifier("undefined")
			},
		};
	});
}

// creates a list of var declaration from an array of
// variable names and an optional array of initial values
function zipDeclare(vars, values) {
	if (!vars) return [];
	values = values || [];
	return vars.map(function (varName, index) {
		return {
			type: "VariableDeclaration",
			kind: "var",
			declarations: [{
				type: "VariableDeclarator",
				id: identifier(varName),
				init: values[index] || null
			}]
		};
	});
}

function identifier(name) {
	return {
		type: "Identifier",
		name: name
	};
}

function literal(value) {
	return {
		type: "Literal",
		value: value
	};
}

function mapTree(node, context) {
	if (node && typeof(node) === "object") {
		return (transforms[node.type] || mapChildren)(node, context);
	}
	return node;
}

function mapChildren(node, context) {
	var mapped;
	if (node instanceof Array) {
		mapped = node.map(function (item) {
			return mapTree(item, context);
		});
	}
	else {
		mapped = {};
		for (var key in node) {
			mapped[key] = mapTree(node[key], context);
		}
	}
	return mapped;
}

function mix(obj1, obj2) {
	var key;
	var combined = {};
	for (key in obj1) {
		combined[key] = obj1[key];
	}
	for (key in obj2) {
		combined[key] = obj2[key];
	}
	return combined;
}

// deep object subset equality
function matchObject(obj, pattern) {
	if (typeof(obj) === "object" && typeof(pattern) === "object") {
		for (var key in pattern) {
			if (!matchObject(obj[key], pattern[key])) return false;
		}
		return true;
	}
	return obj === pattern;
}

function pluck(key) {
	return function (obj) {
		if (obj) return obj[key];
	};
}

function prefix(pre) {
	return function (str) {
		return pre + str;
	};
}

function always(value) {
	return function () {
		return value;
	}
}

function eachPair(array1, array2, func) {
	var count = Math.max(array1.length, array2.length);
	for (var i = 0; i < count; i++) {
		func(array1[i], array2[i], i);
	}
}

module.exports = tailCallOptimise;
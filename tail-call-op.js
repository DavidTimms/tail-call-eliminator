// TODO:
// X assign local variables to undefined before looping.
// - remove unnecessary temp variable assignments
//   for loop invariants.
// X convert ternary ifs in tail position to if
//   statements, so they can be optimised correctly.
// - Implicit accumulators for associative operations 
//   in tail position (eg. + and *) .

// main entry point. Takes and returns a Mozilla AST
function tailCallOptimise(ast) {
	return mapTree(ast, {});
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
		subContext.localVars = [];
		var mapped = mapChildren(node, subContext);

		// if the function has been found to be tail recursive
		// then wrap the function body in a while loop
		if (subContext.isTailRecursive) {
			var funcBlock = mapped.body;

			// add declarations for local variables 
			var undefinedIntialValues = 
				subContext.localVars.map(always(identifier("undefined")));

			funcBlock.body = 
				zipDeclare(subContext.localVars, undefinedIntialValues)
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
				body: zipDeclare(subContext.tempNames)
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
	}
};

// replace the return statement with assignments to 
// clear all variables in the scope and continue to repeat
// the loop
function convertTailCall(node, context) {
	context.isTailRecursive = true;
	var args = node.argument.arguments;

	return {
		type: "BlockStatement",
		body: zipAssign(context.tempNames, args)
			.concat(filteredZipAssign(
				context.params, 
				context.tempNames.map(identifier)))
			.concat({
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


function filteredZipAssign(vars, values) {
	var filteredVars = [], filteredValues = [];
	values.forEach(function (value, i) {
		if (!(	value && 
				value.name && 
				("_tco_temp_" + value.name) === vars[i])) {
			filteredVars.push(vars[i]);
			filteredValues.push(value);
		}
	});
	return zipAssign(filteredVars, filteredValues);
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
		//console.log(node.type + " " + (node.name || (node.id ? node.id.name : "")));
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

var src = "(" + function recursive(x, y) {
	function doThing() {
		return doThing();
	}
	var z = function () {};
	console.log(x, y, z);
	return recursive(x + 1, y + 1);
} + ")()";

module.exports = tailCallOptimise;
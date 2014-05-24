var tco = require("./tail-call-op.js");
var esprima = require("esprima");
var escodegen = require("escodegen");

var log = console.log.bind(console);
var note = function (msg) {
	console.log(msg);
}

// recursively sum a list of numbers.
// tests the optimisation of ternary if expression at the tail.
function sum(items, current) {
	current = current || 0;
	return items.length ? 
		sum(items.slice(1), current + items[0]) : current;
}
testFunction(sum, [[45, 65, 26, 64]]);

// The local variable should be undefined before it is declared.
function localVar(i) {
	if (local) return false;
	var local = true;
	if (i) return localVar(i - 1);
	return local;
}
testFunction(localVar, [10]);

// the value of x never changes so it should not be reassigned.
function loopInvariant(i, x) {
	if (typeof(_tco_temp_x) !== "undefined")
		return false;
	if (i) return loopInvariant(i - 1, x);
	return true;
}
testFunction(loopInvariant, [5, true]);


function testFunction(func, args) {
	log("\nTesting Function: " + func.name);
	var AST = esprima.parse(func.toString());
	note("    parsed");
	var optimisedAST = tco(AST);
	note("    optimised");
	var optimised = eval("(" + escodegen.generate(optimisedAST) + ")");
	note("    recompiled");
	note("    source: \n" + optimised.toString());

	var expected = func.apply(null, args);
	log("    expected output: " + expected);
	var actual = optimised.apply(null, args);
	if (actual === expected) {
		log("    TEST PASSED");
	} else {
		log("    FAILED");
		log("    received output: " + actual);
	}
}
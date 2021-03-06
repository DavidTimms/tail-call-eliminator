var tco = require("./tail-call-op.js");
var esprima = require("esprima");
var escodegen = require("escodegen");

verbose = process.argv[2] === "--verbose";

var log = console.log.bind(console);
var logV = function (msg) {
	if (verbose) console.log(msg);
}

//======================TEST FUNCTIONS=======================//

// simple recursive function
function difference(from, to, total) {
	if(from >= to) return total;

	return difference(from + 1, to, total + 1);
}
testFunction(difference, [0, 10000, 0]);

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

// a function with multiple tail calls
function multiTail(xs, numOdds) {
	if (!xs.length) return numOdds;
	if (xs[0] % 2 === 1) {
		return multiTail(xs.slice(1), numOdds + 1);
	}
	else {
		return multiTail(xs.slice(1), numOdds);
	}
}
testFunction(multiTail, [[1,4,7,6,3,7,2], 0]);

// nested tail-recursive functions
function outer() {
	var count = 0;
	(function nested(i) {
		if (i) {
			count += (function inner(i) {
				return i ? inner(i - 1) : 25;
			})(20);
			return nested(i - 1);
		}
	})(30);
	return count;
}
testFunction(outer);

// factorial function which will overflow the stack without optimisation
function fact(x, acc) {
	acc = acc || 1;
	if (x) return fact(x - 1, x * acc);
	else return acc;
}
testFunction(fact, [25000]);

// variable declaration within for loop initialisation
function forLoop() {
	var total = 0;
	for (var i = 0; i < 10; i++) {
		total += i;
	}
	for (j = 0; j < 10; j++) {
		total += j;
	}
	if (false) return forLoop();
	return total;
}
testFunction(forLoop);

// non-recursive function should maintain variable locality (shadowing)
function nonRecursive() {
	var y = true;
	(function inner(x) {
		var y = false;
	})();
	return y;
}
testFunction(nonRecursive);

// non-recursive function with no init for local var
function localNoInit() {
	var x;
	var y = 2;
	return x;
}
testFunction(localNoInit);

// preserve "use strict"
function useStrict() {
	"use strict";
	var localVar = 78;
	try {
		notDeclared = 23;
	}
	catch (e) {
		return true;
	}
	// nested function to check that only the top scope has
	// use strict instruction
	function foo() {

	}
	return false;
}
testFunction(useStrict);


// multiple declarations of locals
function multiLocals(y, z) {
	var x = 2;

	var x = 4;

	if (false)
		return multiLocals(5, 7);

	return x;
}
testFunction(multiLocals);

// sequence expression in ternary if
function seqTernary(a) {

	return a ? (a -= 1, seqTernary(a - 1)) : a;
}
testFunction(seqTernary, [20000]);

//===========================================================//

// Test the original and optimised versions of a function to 
// check that they give the same result, printing the outcome
// to the console
function testFunction(func, args) {
	args = args || [];
	log("\nTesting Function: " + func.name);
	var optimised = eval("(" + tco(func) + ")");
	logV("    source: \n" + optimised.toString());

	try {
		var expected = func.apply(null, args);
	}
	catch (e) {
		if (e instanceof RangeError) {
			logV("Original version causes stack overflow");
		}
	}
	if (expected !== undefined) {
		log("    expected output: " + expected);
	}

	try {
		var actual = optimised.apply(null, args);
	}
	catch (e) {
		var failed = true;
	}
	if (failed) {
		log("    FAILED");
		log("    Eliminator failed to avoid stack overflow");
	}
	else if (expected === undefined || actual === expected) {
		log("    TEST PASSED");
	} else {
		log("    FAILED");
		log("    received output: " + actual);
	}
}
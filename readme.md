Tail Call Eliminator
====================

This module traverses a Mozilla Parser AST, such those produced by [Esprima](http://esprima.org/), to convert simple recursive functions to imperative while loops, while maintaining the same behaviour. This saves memory and avoids stack overflow. It might come in handy if you're compiling a function language to JavaScript.

Usage
-----
Install via [NPM](https://www.npmjs.org/package/tail-call-eliminator).

    npm install tail-call-eliminator

The module's API is a single function, so using it is simple.

	var tailCallElim = require("tail-call-eliminator");

	tailCallElim(function recursive(x) {
		if (x) return recursive(x - 1);
	});

The function accepts either a string or an AST object, and returns the same type. If you pass a function, it will be converted to a string. String inputs are parsed into an AST using [Esprima](http://esprima.org/), then optimised, before being converted back to a source string using [Escodegen](https://github.com/Constellation/escodegen).

Advantages
----------
Tail Call Eliminator has several advantages over other AST rewriters which do a similar job:

 - It builds a new AST object, rather than mutating the input.
 - It produces fewer temporary variable, so the output is shorter and easier to understand.
 - It correctly resets the value of local variables to `undefined` when repeating the function,
   rather than preserving their previous value.
 - It works correctly on functions which return a ternary if expression, such as:

        return i ? repeat(i - 1) : false;

Limitations
-----------
The module has some limitation which you should be aware of before using it:

 - To be optimised, a function must be named. Even if an anonymous function is assigned to a variable, it will not be optimised without a name.
 - Mutually tail-recursive functions cannot be optimised using this technique.
 - If you create a nested function within your recursive function, the values captured in it's closure may not be preserved, as the stack frame is reused for successive iterations. It is very rare that this should cause an issue.
 - The optimised AST does not correctly preserve source-map data at the moment. This should be fixed in the future.
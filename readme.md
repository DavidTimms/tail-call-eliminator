Tail Call Eliminator
====================

This module traverses a Mozilla Parser AST, such those produced by [Esprima](http://esprima.org/), to convert simple recursive functions to imperative while loops, while maintaining the same behaviour. 
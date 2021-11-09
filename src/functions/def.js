import defineFunction from "../defineFunction";
import ParseError from "../ParseError";

const checkControlSequence = (tok) => {
  const name = tok.text;
  if (/^(?:[\\{}$&#^_]|EOF)$/.test(name)) {
    throw new ParseError("Expected a control sequence", tok);
  }
  return name;
};

const getRHS = (parser) => {
  let tok = parser.gullet.popToken();
  if (tok.text === "=") {
    // consume optional equals
    tok = parser.gullet.popToken();
    if (tok.text === " ") {
      // consume one optional space
      tok = parser.gullet.popToken();
    }
  }
  return tok;
};

const letCommand = (parser, name, tok) => {
  let macro = parser.gullet.macros.get(tok.text);
  if (macro == null) {
    // don't expand it later even if a macro with the same name is defined
    // e.g., \let\foo=\frac \def\frac{\relax} \frac12
    tok.noexpand = true;
    macro = {
      tokens: [tok],
      numArgs: 0,
      // reproduce the same behavior in expansion
      unexpandable: !parser.gullet.isExpandable(tok.text)
    };
  }
  parser.gullet.macros.set(name, macro);
};

// Basic support for macro definitions: \def
// <definition> -> <def><control sequence><definition text>
// <definition text> -> <parameter text><left brace><balanced text><right brace>
defineFunction({
  type: "internal",
  names: ["\\def", "\\edef"],
  props: {
    numArgs: 0,
    allowedInText: true,
    primitive: true
  },
  handler({ parser, funcName }) {
    let tok = parser.gullet.popToken();
    const name = tok.text;
    if (/^(?:[\\{}$&#^_]|EOF)$/.test(name)) {
      throw new ParseError("Expected a control sequence", tok);
    }

    let numArgs = 0;
    let insert;
    const delimiters = [[]];
    // <parameter text> contains no braces
    while (parser.gullet.future().text !== "{") {
      tok = parser.gullet.popToken();
      if (tok.text === "#") {
        // If the very last character of the <parameter text> is #, so that
        // this # is immediately followed by {, TeX will behave as if the {
        // had been inserted at the right end of both the parameter text
        // and the replacement text.
        if (parser.gullet.future().text === "{") {
          insert = parser.gullet.future();
          delimiters[numArgs].push("{");
          break;
        }

        // A parameter, the first appearance of # must be followed by 1,
        // the next by 2, and so on; up to nine #’s are allowed
        tok = parser.gullet.popToken();
        if (!/^[1-9]$/.test(tok.text)) {
          throw new ParseError(`Invalid argument number "${tok.text}"`);
        }
        if (parseInt(tok.text) !== numArgs + 1) {
          throw new ParseError(`Argument number "${tok.text}" out of order`);
        }
        numArgs++;
        delimiters.push([]);
      } else if (tok.text === "EOF") {
        throw new ParseError("Expected a macro definition");
      } else {
        delimiters[numArgs].push(tok.text);
      }
    }
    // replacement text, enclosed in '{' and '}' and properly nested
    let { tokens } = parser.gullet.consumeArg();
    if (insert) {
      tokens.unshift(insert);
    }

    if (funcName === "\\edef") {
      tokens = parser.gullet.expandTokens(tokens);
      tokens.reverse(); // to fit in with stack order
    }
    // Final arg is the expansion of the macro
    parser.gullet.macros.set(name, { tokens, numArgs, delimiters }
    );
    return { type: "internal", mode: parser.mode };
  }
});

// <simple assignment> -> <let assignment>
// <let assignment> -> \futurelet<control sequence><token><token>
//     | \let<control sequence><equals><one optional space><token>
// <equals> -> <optional spaces>|<optional spaces>=
defineFunction({
  type: "internal",
  names: ["\\let"],
  props: {
    numArgs: 0,
    allowedInText: true,
    primitive: true
  },
  handler({ parser, funcName }) {
    const name = checkControlSequence(parser.gullet.popToken());
    parser.gullet.consumeSpaces();
    const tok = getRHS(parser);
    letCommand(parser, name, tok);
    return { type: "internal", mode: parser.mode };
  }
});

// ref: https://www.tug.org/TUGboat/tb09-3/tb22bechtolsheim.pdf
defineFunction({
  type: "internal",
  names: ["\\futurelet"],
  props: {
    numArgs: 0,
    allowedInText: true,
    primitive: true
  },
  handler({ parser, funcName }) {
    const name = checkControlSequence(parser.gullet.popToken());
    const middle = parser.gullet.popToken();
    const tok = parser.gullet.popToken();
    letCommand(parser, name, tok);
    parser.gullet.pushToken(tok);
    parser.gullet.pushToken(middle);
    return { type: "internal", mode: parser.mode };
  }
});

defineFunction({
  type: "internal",
  names: ["\\newcommand", "\\renewcommand", "\\providecommand"],
  props: {
    numArgs: 0,
    allowedInText: true,
    primitive: true
  },
  handler({ parser, funcName }) {
    let name = ""
    const tok = parser.gullet.popToken()
    if (tok.text === "{") {
      name = checkControlSequence(parser.gullet.popToken())
      parser.gullet.popToken()
    } else {
      name = checkControlSequence(tok)
    }

    const exists = parser.gullet.isDefined(name);
    if (exists && funcName === "\\newcommand") {
      throw new ParseError(
        `\\newcommand{${name}} attempting to redefine ${name}; use \\renewcommand`
      );
    }
    if (!exists && funcName === "\\renewcommand") {
      throw new ParseError(
        `\\renewcommand{${name}} when command ${name} does not yet exist; use \\newcommand`
      );
    }

    let numArgs = 0;
    if (parser.gullet.future().text === "[") {
      let tok = parser.gullet.popToken();
      tok = parser.gullet.popToken();
      if (!/^[0-9]$/.test(tok.text)) {
        throw new ParseError(`Invalid number of arguments: "${tok.text}"`);
      }
      numArgs = parseInt(tok.text);
      tok = parser.gullet.popToken();
      if (tok.text !== "]") {
        throw new ParseError(`Invalid argument "${tok.text}"`);
      }
    }

    // replacement text, enclosed in '{' and '}' and properly nested
    const { tokens } = parser.gullet.consumeArg();

    parser.gullet.macros.set(name, { tokens, numArgs })

    return { type: "internal", mode: parser.mode };

  }
});

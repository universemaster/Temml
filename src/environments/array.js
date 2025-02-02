import defineEnvironment from "../defineEnvironment";
import { parseCD } from "./cd";
import defineFunction from "../defineFunction";
import mathMLTree from "../mathMLTree";
import { StyleLevel } from "../constants"
import ParseError from "../ParseError";
import { assertNodeType, assertSymbolNodeType } from "../parseNode";
import { checkSymbolNodeType } from "../parseNode";
import utils from "../utils";

import * as mml from "../buildMathML";

// Helper functions
function getHLines(parser) {
  // Return an array. The array length = number of hlines.
  // Each element in the array tells if the line is dashed.
  const hlineInfo = [];
  parser.consumeSpaces();
  let nxt = parser.fetch().text;
  while (nxt === "\\hline" || nxt === "\\hdashline") {
    parser.consume();
    hlineInfo.push(nxt === "\\hdashline");
    parser.consumeSpaces();
    nxt = parser.fetch().text;
  }
  return hlineInfo;
}

const validateAmsEnvironmentContext = context => {
  const settings = context.parser.settings;
  if (!settings.displayMode) {
    throw new ParseError(`{${context.envName}} can be used only in display mode.`);
  }
}

const getTag = (group, style, rowNum) => {
  let tag
  const tagContents = group.tags.shift()
  if (tagContents) {
    // The author has written a \tag or a \notag in this row.
    if (tagContents.body) {
      tag = mml.buildExpressionRow(tagContents.body, style)
      tag.classes = ["tml-tag"]
    } else {
      // \notag. Return an empty span.
      tag = new mathMLTree.MathNode("mtext", [], [])
      return tag
    }
  } else if (group.colSeparationType === "multline" &&
    ((group.leqno && rowNum !== 0) || (!group.leqno && rowNum !== group.body.length - 1))) {
    // A multiline that does not receive a tag. Return an empty cell.
    tag = new mathMLTree.MathNode("mtext", [], [])
    return tag
  } else {
    // AMS automatcally numbered equaton.
    // Insert a class so the element can be populated by a post-processor.
    tag = new mathMLTree.MathNode("mtext", [], ["tml-eqn"])
  }
  return tag
}

/**
 * Parse the body of the environment, with rows delimited by \\ and
 * columns delimited by &, and create a nested list in row-major order
 * with one group per cell.  If given an optional argument scriptLevel
 * ("text", "display", etc.), then each cell is cast into that scriptLevel.
 */
function parseArray(
  parser,
  {
    hskipBeforeAndAfter, // boolean
    addJot, // boolean
    cols, // [{ type: string , align: l|c|r|null }]
    arraystretch, // number
    colSeparationType, // "align" | "alignat" | "gather" | "small" | "CD" | "multline"
    addEqnNum, // boolean
    singleRow, // boolean
    emptySingleRow, // boolean
    maxNumCols, // number
    leqno // boolean
  },
  scriptLevel
) {
  parser.gullet.beginGroup();
  if (!singleRow) {
    // \cr is equivalent to \\ without the optional size argument (see below)
    // TODO: provide helpful error when \cr is used outside array environment
    parser.gullet.macros.set("\\cr", "\\\\\\relax");
  }
  if (addEqnNum) {
    parser.gullet.macros.set("\\tag", "\\env@tag{\\text{#1}}");
    parser.gullet.macros.set("\\notag", "\\env@notag");
    parser.gullet.macros.set("\\nonumber", "\\env@notag")
  }

  // Get current arraystretch if it's not set by the environment
  if (arraystretch === undefined || Number.isNaN(arraystretch)) {
    const stretch = parser.gullet.expandMacroAsText("\\arraystretch");
    if (stretch == null) {
      // Default \arraystretch from lttab.dtx
      arraystretch = 1
    } else {
      arraystretch = parseFloat(stretch);
      if (!arraystretch || arraystretch < 0) {
        throw new ParseError(`Invalid \\arraystretch: ${stretch}`);
      }
    }
  }

  // Start group for first cell
  parser.gullet.beginGroup();

  let row = [];
  const body = [row];
  const rowGaps = [];
  const tags = [];
  let rowTag;
  const hLinesBeforeRow = [];

  // Test for \hline at the top of the array.
  hLinesBeforeRow.push(getHLines(parser));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Parse each cell in its own group (namespace)
    let cell = parser.parseExpression(false, singleRow ? "\\end" : "\\\\");

    if (addEqnNum && !rowTag) {
      // Check if the author wrote a \tag{} inside this cell.
      for (let i = 0; i < cell.length; i++) {
        if (cell[i].type === "envTag" || cell[i].type === "noTag") {
          // Get the contents of the \text{} nested inside the \env@Tag{}
          rowTag = cell[i].type === "envTag"
            ? cell.splice(i, 1)[0].body.body[0]
            : { body: null };
          break
        }
      }
    }
    parser.gullet.endGroup();
    parser.gullet.beginGroup();

    cell = {
      type: "ordgroup",
      mode: parser.mode,
      body: cell
    };
    row.push(cell);
    const next = parser.fetch().text;
    if (next === "&") {
      if (maxNumCols && row.length === maxNumCols) {
        if (colSeparationType === "split") {
          throw new ParseError("The split environment accepts no more than two columns",
            parser.nextToken);
        } else if (colSeparationType === "array") {
          if (parser.settings.strict) {
            throw new ParseError("Too few columns " + "specified in the {array} column argument.",
              parser.nextToken)
          }
        } else {
          throw new ParseError("The equation environment accepts only one column",
            parser.nextToken)
        }
      }
      parser.consume();
    } else if (next === "\\end") {
      // Arrays terminate newlines with `\crcr` which consumes a `\cr` if
      // the last line is empty.  However, AMS environments keep the
      // empty row if it's the only one.
      // NOTE: Currently, `cell` is the last item added into `row`.
      if (row.length === 1 && cell.body.length === 0 && (body.length > 1 || !emptySingleRow)) {
        body.pop();
      }
      if (hLinesBeforeRow.length < body.length + 1) {
        hLinesBeforeRow.push([]);
      }
      break;
    } else if (next === "\\\\") {
      parser.consume();
      let size;
      // \def\Let@{\let\\\math@cr}
      // \def\math@cr{...\math@cr@}
      // \def\math@cr@{\new@ifnextchar[\math@cr@@{\math@cr@@[\z@]}}
      // \def\math@cr@@[#1]{...\math@cr@@@...}
      // \def\math@cr@@@{\cr}
      if (parser.gullet.future().text !== " ") {
        size = parser.parseSizeGroup(true);
      }
      rowGaps.push(size ? size.value : null);

      tags.push(rowTag)

      // check for \hline(s) following the row separator
      hLinesBeforeRow.push(getHLines(parser));

      row = [];
      rowTag = null;
      body.push(row);
    } else {
      throw new ParseError("Expected & or \\\\ or \\cr or \\end", parser.nextToken);
    }
  }

  // End cell group
  parser.gullet.endGroup();
  // End array group defining \cr
  parser.gullet.endGroup();

  tags.push(rowTag)

  return {
    type: "array",
    mode: parser.mode,
    addJot,
    arraystretch,
    body,
    cols,
    rowGaps,
    hskipBeforeAndAfter,
    hLinesBeforeRow,
    colSeparationType,
    addEqnNum,
    scriptLevel,
    tags,
    leqno
  };
}

// Decides on a scriptLevel for cells in an array according to whether the given
// environment name starts with the letter 'd'.
function dCellStyle(envName) {
  return envName.slice(0, 1) === "d" ? "display" : "text"
}

const alignMap = {
  c: "center ",
  l: "left ",
  r: "right "
};

const glue = group => {
  const glueNode = new mathMLTree.MathNode("mtd", [])
  glueNode.style = { padding: "0", width: "50%" }
  if (group.colSeparationType === "multline") {
    glueNode.style.width = "7.5%"
  }
  return glueNode
}

const mathmlBuilder = function(group, style) {
  const tbl = [];
  const numRows = group.body.length
  const hlines = group.hLinesBeforeRow;

  for (let i = 0; i < numRows; i++) {
    const rw = group.body[i];
    const row = [];
    const cellStyle = group.scriptLevel === "text"
    ? StyleLevel.TEXT
    : group.scriptLevel === "script"
    ? StyleLevel.SCRIPT
    : StyleLevel.DISPLAY

    for (let j = 0; j < rw.length; j++) {
      const mtd = new mathMLTree.MathNode(
        "mtd",
        [mml.buildGroup(rw[j], style.withLevel(cellStyle))]
      )

      if (group.colSeparationType === "multline") {
        const align = i === 0 ? "left" : i === numRows - 1 ? "right" : "center"
        mtd.setAttribute("columnalign", align)
        if (align !== "center") {
          mtd.style.textAlign = "-webkit-" + align
        }
      }
      row.push(mtd)
    }
    if (group.addEqnNum) {
      row.unshift(glue(group));
      row.push(glue(group));
      const tag = getTag(group, style.withLevel(cellStyle), i)
      if (group.leqno) {
        row[0].children.push(tag)
        row[0].style.textAlign = "-webkit-left"
      } else {
        row[row.length - 1].children.push(tag)
        row[row.length - 1].style.textAlign = "-webkit-right"
      }
    }
    const mtr = new mathMLTree.MathNode("mtr", row, [])
    // Write horizontal rules
    if (i === 0 && hlines[0].length > 0) {
      mtr.classes.push(hlines[0][0] ? "tml-top-dashed" : "tml-top-solid")
    }
    if (hlines[i + 1].length > 0) {
      mtr.classes.push(hlines[i + 1][0] ? "hline-dashed" : "hline-solid")
    }
    tbl.push(mtr);
  }
  let table = new mathMLTree.MathNode("mtable", tbl);
  if (!group.addEqnNum) { table.classes.push("tml-array") }
  if (group.scriptLevel === "display") { table.setAttribute("displaystyle", "true") }

  // Set column alignment, row spacing, column spacing, and
  // array lines by setting attributes on the table element.

  // Set the row spacing. In MathML, we specify a gap distance.
  // We do not use rowGap[] because MathML automatically increases
  // cell height with the height/depth of the element content.

  // LaTeX \arraystretch multiplies the row baseline-to-baseline distance.
  // We simulate this by adding (arraystretch - 1)em to the gap. This
  // does a reasonable job of adjusting arrays containing 1 em tall content.

  // The 0.16 and 0.09 values are found emprically. They produce an array
  // similar to LaTeX and in which content does not interfere with \hines.
  const gap =
    group.arraystretch === 0
      ? 0 // {subarray}
      : group.arraystretch === 0.5
      ? 0.1 // {smallmatrix}
      : 0.16 + group.arraystretch - 1 + (group.addJot ? 0.09 : 0);
  table.setAttribute("rowspacing", utils.round(gap) + "em")

  if (group.arraystretch > 1) {
    const pad = `calc(${utils.round((group.arraystretch - 1) / 2)}em + 0.5ex) 0.4em`
    for (const row of table.children) {
      for (const cell of row.children) {
        cell.style.padding = pad
      }
    }
  }

  if (group.addEqnNum || group.colSeparationType === "multline") {
    table.setAttribute("width", "100%")
  }

  // Column separator lines and column alignment
  let align = "";
  let columnLines = ""

  if (group.cols && group.cols.length > 0) {
    const cols = group.cols;
    let prevTypeWasAlign = false;
    let iStart = 0;
    let iEnd = cols.length;

    while (cols[iStart].type === "separator") {
      iStart += 1
    }
    while (cols[iEnd - 1].type === "separator") {
      iEnd -= 1
    }

    if (cols[0].type === "separator") {
      for (const row of table.children) {
        const sep = cols[0].separator === "|" ? "solid " : "dashed "
        row.children[0].style.borderLeft = sep
        row.children[0].style.paddingLeft = "0.4em"
      }
    }
    let iCol = group.addEqnNum ? 0 : -1
    for (let i = iStart; i < iEnd; i++) {
      if (cols[i].type === "align") {
        const colAlign = alignMap[cols[i].align];
        align += colAlign
        iCol += 1
        for (const row of table.children) {
          if (colAlign.trim() !== "center" && iCol < row.children.length) {
            row.children[iCol].style.textAlign = "-webkit-" + colAlign.trim()
          }
        }

        if (prevTypeWasAlign) {
          columnLines += "none ";
        }
        prevTypeWasAlign = true;
      } else if (cols[i].type === "separator") {
        // MathML accepts only single lines between cells.
        // So we read only the first of consecutive separators.
        if (prevTypeWasAlign) {
          const sep = cols[i].separator === "|" ? "0.06em solid" : "0.06em dashed"
          columnLines += sep
          for (const row of table.children) {
            if (iCol < row.children.length) {
              row.children[iCol].style.borderRight = sep
            }
          }
        }
      }
    }
    if (cols[cols.length - 1].type === "separator") {
      for (const row of table.children) {
        const sep = cols[cols.length - 1].separator === "|" ? "0.06em solid" : "0.06em dashed"
        row.children[row.children.length - 1].style.borderRight = sep
        row.children[row.children.length - 1].style.paddingRight = "0.4em"
      }
    }
  }
  if (group.addEqnNum) {
    align = "left " + align + "right " // allow for glue cells on each side
    align = group.leqno ? "left " + align : align += "right"  // eqn num cell
  }
  if (align) {
    table.setAttribute("columnalign", align.trim())
  }
  if (/[sd]/.test(columnLines)) {
    table.setAttribute("columnlines", columnLines.trim())
  }

  // Set column spacing.
  switch (group.colSeparationType) {
    case "gather":
    case "gathered":
    case "alignedat":
    case "alignat":
    case "alignat*":
    case "split":
      table.setAttribute("columnspacing", "0em")
      table.classes.push("tml-gather")
      break
    case "small":
      table.setAttribute("columnspacing", "0.2778em")
      table.classes.push("tml-small")
      break
    case "CD":
      table.setAttribute("columnspacing", "0.5em")
      table.classes.push("tml-gather")
      break
    case "align":
    case "align*": {
      table.classes.push("tml-gather")
      const cols = group.cols || [];
      let spacing = group.addEqnNum ? "0em " : ""
      for (let i = 1; i < cols.length; i++) {
        spacing += i % 2 ? "0em " : "1em "
      }
      if (group.addEqnNum) { spacing += "0em" }
      table.setAttribute("columnspacing", spacing.trim())
      break
    }
    default:
      table.setAttribute("columnspacing", "1em")
  }

  if (!Number.isNaN(group.arraystretch) && group.arraystretch < 1) {
    // A small array. Wrap in scriptstyle so row gap is not too large.
    table = new mathMLTree.MathNode("mstyle", [table])
    table.setAttribute("scriptlevel", "1")
  }

  return table
};

// Convenience function for align, align*, aligned, alignat, alignat*, alignedat.
const alignedHandler = function(context, args) {
  if (context.envName.indexOf("ed") === -1) {
    validateAmsEnvironmentContext(context);
  }
  const cols = [];
  const res = parseArray(
    context.parser,
    {
      cols,
      addJot: true,
      addEqnNum: context.envName === "align" || context.envName === "alignat",
      emptySingleRow: true,
      colSeparationType: context.envName,
      maxNumCols: context.envName === "split" ? 2 : undefined,
      leqno: context.parser.settings.leqno
    },
    "display"
  );

  // Determining number of columns.
  // 1. If the first argument is given, we use it as a number of columns,
  //    and makes sure that each row doesn't exceed that number.
  // 2. Otherwise, just count number of columns = maximum number
  //    of cells in each row ("aligned" mode -- isAligned will be true).
  //
  // At the same time, prepend empty group {} at beginning of every second
  // cell in each row (starting with second cell) so that operators become
  // binary.  This behavior is implemented in amsmath's \start@aligned.
  let numMaths;
  let numCols = 0;
  if (args[0] && args[0].type === "ordgroup") {
    let arg0 = "";
    for (let i = 0; i < args[0].body.length; i++) {
      const textord = assertNodeType(args[0].body[i], "textord");
      arg0 += textord.text;
    }
    numMaths = Number(arg0);
    numCols = numMaths * 2;
  }
  const isAligned = !numCols;
  res.body.forEach(function(row) {
    if (!isAligned) {
      // Case 1
      const curMaths = row.length / 2;
      if (numMaths < curMaths) {
        throw new ParseError(
          "Too many math in a row: " + `expected ${numMaths}, but got ${curMaths}`,
          row[0]
        );
      }
    } else if (numCols < row.length) {
      // Case 2
      numCols = row.length;
    }
  });

  // Adjusting alignment.
  // In aligned mode, we add one \qquad between columns;
  // otherwise we add nothing.
  for (let i = 0; i < numCols; ++i) {
    let align = "r";
    if (i % 2 === 1) {
      align = "l";
    }
    cols[i] = {
      type: "align",
      align: align
    };
  }
  res.colSeparationType = isAligned ? "align" : "alignat";
  return res;
};

// Arrays are part of LaTeX, defined in lttab.dtx so its documentation
// is part of the source2e.pdf file of LaTeX2e source documentation.
// {darray} is an {array} environment where cells are set in \displaystyle,
// as defined in nccmath.sty.
defineEnvironment({
  type: "array",
  names: ["array", "darray"],
  props: {
    numArgs: 1
  },
  handler(context, args) {
    // Since no types are specified above, the two possibilities are
    // - The argument is wrapped in {} or [], in which case Parser's
    //   parseGroup() returns an "ordgroup" wrapping some symbol node.
    // - The argument is a bare symbol node.
    const symNode = checkSymbolNodeType(args[0]);
    const colalign = symNode ? [args[0]] : assertNodeType(args[0], "ordgroup").body;
    const cols = colalign.map(function(nde) {
      const node = assertSymbolNodeType(nde);
      const ca = node.text;
      if ("lcr".indexOf(ca) !== -1) {
        return {
          type: "align",
          align: ca
        };
      } else if (ca === "|") {
        return {
          type: "separator",
          separator: "|"
        };
      } else if (ca === ":") {
        return {
          type: "separator",
          separator: ":"
        };
      }
      throw new ParseError("Unknown column alignment: " + ca, nde);
    });
    const res = {
      cols,
      colSeparationType: "array",
      hskipBeforeAndAfter: true, // \@preamble in lttab.dtx
      maxNumCols: cols.length
    };
    return parseArray(context.parser, res, dCellStyle(context.envName));
  },
  mathmlBuilder
});

// The matrix environments of amsmath builds on the array environment
// of LaTeX, which is discussed above.
// The mathtools package adds starred versions of the same environments.
// These have an optional argument to choose left|center|right justification.
defineEnvironment({
  type: "array",
  names: [
    "matrix",
    "pmatrix",
    "bmatrix",
    "Bmatrix",
    "vmatrix",
    "Vmatrix",
    "matrix*",
    "pmatrix*",
    "bmatrix*",
    "Bmatrix*",
    "vmatrix*",
    "Vmatrix*"
  ],
  props: {
    numArgs: 0
  },
  handler(context) {
    const delimiters = {
      matrix: null,
      pmatrix: ["(", ")"],
      bmatrix: ["[", "]"],
      Bmatrix: ["\\{", "\\}"],
      vmatrix: ["|", "|"],
      Vmatrix: ["\\Vert", "\\Vert"]
    }[context.envName.replace("*", "")];
    // \hskip -\arraycolsep in amsmath
    let colAlign = "c";
    const payload = {
      hskipBeforeAndAfter: false,
      colSeparationType: "matrix",
      cols: [{ type: "align", align: colAlign }]
    };
    if (context.envName.charAt(context.envName.length - 1) === "*") {
      // It's one of the mathtools starred functions.
      // Parse the optional alignment argument.
      const parser = context.parser;
      parser.consumeSpaces();
      if (parser.fetch().text === "[") {
        parser.consume();
        parser.consumeSpaces();
        colAlign = parser.fetch().text;
        if ("lcr".indexOf(colAlign) === -1) {
          throw new ParseError("Expected l or c or r", parser.nextToken);
        }
        parser.consume();
        parser.consumeSpaces();
        parser.expect("]");
        parser.consume();
        payload.cols = [{ type: "align", align: colAlign }];
      }
    }
    const res = parseArray(context.parser, payload, "text");
    // Populate cols with the correct number of column alignment specs.
    const numCols = Math.max(0, ...res.body.map((row) => row.length));
    res.cols = new Array(numCols).fill({ type: "align", align: colAlign })
    return delimiters
      ? {
        type: "leftright",
        mode: context.mode,
        body: [res],
        left: delimiters[0],
        right: delimiters[1],
        rightColor: undefined // \right uninfluenced by \color in array
      }
      : res;
  },
  mathmlBuilder
});

defineEnvironment({
  type: "array",
  names: ["smallmatrix"],
  props: {
    numArgs: 0
  },
  handler(context) {
    const payload = { arraystretch: 0.5 };
    const res = parseArray(context.parser, payload, "script");
    res.colSeparationType = "small";
    return res;
  },
  mathmlBuilder
});

defineEnvironment({
  type: "array",
  names: ["subarray"],
  props: {
    numArgs: 1
  },
  handler(context, args) {
    // Parsing of {subarray} is similar to {array}
    const symNode = checkSymbolNodeType(args[0]);
    const colalign = symNode ? [args[0]] : assertNodeType(args[0], "ordgroup").body;
    const cols = colalign.map(function(nde) {
      const node = assertSymbolNodeType(nde);
      const ca = node.text;
      // {subarray} only recognizes "l" & "c"
      if ("lc".indexOf(ca) !== -1) {
        return {
          type: "align",
          align: ca
        };
      }
      throw new ParseError("Unknown column alignment: " + ca, nde);
    });
    if (cols.length > 1) {
      throw new ParseError("{subarray} can contain only one column");
    }
    let res = {
      cols,
      hskipBeforeAndAfter: false,
      colSeparationType: "array",
      arraystretch: 0
    };
    res = parseArray(context.parser, res, "script");
    if (res.body.length > 0 && res.body[0].length > 1) {
      throw new ParseError("{subarray} can contain only one column");
    }
    return res;
  },
  mathmlBuilder
});

// A cases environment (in amsmath.sty) is almost equivalent to
// \def
// \left\{\begin{array}{@{}l@{\quad}l@{}} … \end{array}\right.
// {dcases} is a {cases} environment where cells are set in \displaystyle,
// as defined in mathtools.sty.
// {rcases} is another mathtools environment. It's brace is on the right side.
defineEnvironment({
  type: "array",
  names: ["cases", "dcases", "rcases", "drcases"],
  props: {
    numArgs: 0
  },
  handler(context) {
    const payload = {
      cols: [
        {
          type: "align",
          align: "l"
        },
        {
          type: "align",
          align: "l"
        }
      ],
      colSeparationType: "cases"
    };
    const res = parseArray(context.parser, payload, dCellStyle(context.envName));
    return {
      type: "leftright",
      mode: context.mode,
      body: [res],
      left: context.envName.indexOf("r") > -1 ? "." : "\\{",
      right: context.envName.indexOf("r") > -1 ? "\\}" : ".",
      rightColor: undefined
    };
  },
  mathmlBuilder
});

// In the align environment, one uses ampersands, &, to specify number of
// columns in each row, and to locate spacing between each column.
// align gets automatic numbering. align* and aligned do not.
// The alignedat environment can be used in math mode.
// Note that we assume \nomallineskiplimit to be zero,
// so that \strut@ is the same as \strut.
defineEnvironment({
  type: "array",
  names: ["align", "align*", "aligned", "split"],
  props: {
    numArgs: 0
  },
  handler: alignedHandler,
  mathmlBuilder
});

// A gathered environment is like an array environment with one centered
// column, but where rows are considered lines so get \jot line spacing
// and contents are set in \displaystyle.
defineEnvironment({
  type: "array",
  names: ["gathered", "gather", "gather*"],
  props: {
    numArgs: 0
  },
  handler(context) {
    if (utils.contains(["gather", "gather*"], context.envName)) {
      validateAmsEnvironmentContext(context);
    }
    const res = {
      cols: [
        {
          type: "align",
          align: "c"
        }
      ],
      addJot: true,
      colSeparationType: "gather",
      addEqnNum: context.envName === "gather",
      emptySingleRow: true,
      leqno: context.parser.settings.leqno
    };
    return parseArray(context.parser, res, "display");
  },
  mathmlBuilder
});

// alignat environment is like an align environment, but one must explicitly
// specify maximum number of columns in each row, and can adjust spacing between
// each columns.
defineEnvironment({
  type: "array",
  names: ["alignat", "alignat*", "alignedat"],
  props: {
    numArgs: 1
  },
  handler: alignedHandler,
  mathmlBuilder
});

defineEnvironment({
  type: "array",
  names: ["equation", "equation*"],
  props: {
    numArgs: 0
  },
  handler(context) {
    validateAmsEnvironmentContext(context);
    const res = {
      addEqnNum: context.envName === "equation",
      emptySingleRow: true,
      singleRow: true,
      maxNumCols: 1,
      colSeparationType: "gather",
      leqno: context.parser.settings.leqno
    };
    return parseArray(context.parser, res, "display");
  },
  mathmlBuilder
});

defineEnvironment({
  type: "array",
  names: ["multline", "multline*"],
  props: {
    numArgs: 0
  },
  handler(context) {
    validateAmsEnvironmentContext(context);
    const res = {
      addEqnNum: context.envName === "multline",
      maxNumCols: 1,
      colSeparationType: "multline",
      leqno: context.parser.settings.leqno
    };
    return parseArray(context.parser, res, "display");
  },
  mathmlBuilder
});

defineEnvironment({
  type: "array",
  names: ["CD"],
  props: {
    numArgs: 0
  },
  handler(context) {
    validateAmsEnvironmentContext(context);
    return parseCD(context.parser);
  },
  mathmlBuilder
});

// Catch \hline outside array environment
defineFunction({
  type: "text", // Doesn't matter what this is.
  names: ["\\hline", "\\hdashline"],
  props: {
    numArgs: 0,
    allowedInText: true,
    allowedInMath: true
  },
  handler(context, args) {
    throw new ParseError(`${context.funcName} valid only within array environment`);
  }
});

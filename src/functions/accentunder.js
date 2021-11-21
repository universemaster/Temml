import defineFunction from "../defineFunction";
import mathMLTree from "../mathMLTree";
import stretchy from "../stretchy";

import * as mml from "../buildMathML";

defineFunction({
  type: "accentUnder",
  names: [
    "\\underleftarrow",
    "\\underrightarrow",
    "\\underleftrightarrow",
    "\\undergroup",
    "\\underparen",
    "\\underarc",
    "\\utilde"
  ],
  props: {
    numArgs: 1
  },
  handler: ({ parser, funcName }, args) => {
    const base = args[0];
    return {
      type: "accentUnder",
      mode: parser.mode,
      label: funcName,
      base: base
    };
  },
  mathmlBuilder: (group, style) => {
    const accentNode = stretchy.mathMLnode(group.label);
    const node = new mathMLTree.MathNode("munder", [
      mml.buildGroup(group.base, style),
      accentNode
    ]);
    node.setAttribute("accentunder", "true");
    return node;
  }
});

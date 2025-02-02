//
/**
 * This file contains a list of utility functions which are useful in other
 * files.
 */

/**
 * Return whether an element is contained in a list
 */
const contains = function(list, elem) {
  return list.indexOf(elem) !== -1;
};

/**
 * Provide a default value if a setting is undefined
 */
const deflt = function(setting, defaultIfUndefined) {
  return setting === undefined ? defaultIfUndefined : setting;
};

// hyphenate and escape adapted from Facebook's React under Apache 2 license

const uppercase = /([A-Z])/g;
const hyphenate = function(str) {
  return str.replace(uppercase, "-$1").toLowerCase();
};

const ESCAPE_LOOKUP = {
  "&": "&amp;",
  ">": "&gt;",
  "<": "&lt;",
  '"': "&quot;",
  "'": "&#x27;"
};

const ESCAPE_REGEX = /[&><"']/g;

/**
 * Escapes text to prevent scripting attacks.
 */
function escape(text) {
  return String(text).replace(ESCAPE_REGEX, (match) => ESCAPE_LOOKUP[match]);
}

/**
 * Sometimes we want to pull out the innermost element of a group. In most
 * cases, this will just be the group itself, but when ordgroups and colors have
 * a single element, we want to pull that out.
 */
const getBaseElem = function(group) {
  if (group.type === "ordgroup") {
    if (group.body.length === 1) {
      return getBaseElem(group.body[0]);
    } else {
      return group;
    }
  } else if (group.type === "color") {
    if (group.body.length === 1) {
      return getBaseElem(group.body[0]);
    } else {
      return group;
    }
  } else if (group.type === "font") {
    return getBaseElem(group.body);
  } else {
    return group;
  }
};

/**
 * TeXbook algorithms often reference "character boxes", which are simply groups
 * with a single character in them. To decide if something is a character box,
 * we find its innermost group, and see if it is a single character.
 */
const isCharacterBox = function(group) {
  const baseElem = getBaseElem(group);

  // These are all the types of groups which hold single characters
  return baseElem.type === "mathord" || baseElem.type === "textord" || baseElem.type === "atom"
};

export const assert = function(value) {
  if (!value) {
    throw new Error("Expected non-null, but got " + String(value));
  }
  return value;
};

/**
 * Return the protocol of a URL, or "_relative" if the URL does not specify a
 * protocol (and thus is relative).
 */
export const protocolFromUrl = function(url) {
  const protocol = /^\s*([^\\/#]*?)(?::|&#0*58|&#x0*3a)/i.exec(url);
  return protocol != null ? protocol[1] : "_relative";
};

/**
 * Round `n` to 4 decimal places, or to the nearest 1/10,000th em. The TeXbook
 * gives an acceptable rounding error of 100sp (which would be the nearest
 * 1/6551.6em with our ptPerEm = 10):
 * http://www.ctex.org/documents/shredder/src/texbook.pdf#page=69
 */
const round = function(n) {
  return +n.toFixed(4);
};

const consolidateText = mrow => {
  // If possible, consolidate adjacent <mtext> elements into a single element.
  if (mrow.type !== "mrow") { return mrow }
  if (mrow.children.length === 0) { return mrow } // empty group, e.g., \text{}
  const mtext = mrow.children[0]
  if (!mtext.attributes || mtext.type !== "mtext") { return mrow }
  const variant = mtext.attributes.mathvariant || ""
  for (let i = 1; i < mrow.children.length; i++) {
    // Check each child and, if possible, copy the character into child[0].
    const localVariant = mrow.children[i].attributes.mathvariant || ""
    if (mrow.children[i].type === "mrow") {
      const childRow = mrow.children[i]
      for (let j = 0; j < childRow.children.length; j++) {
        // We'll also check the children of a mrow. One level only. No recursion.
        const childVariant = childRow.children[j].attributes.mathvariant || ""
        if (childVariant !== variant || childRow.children[j].type !== "mtext") {
          return mrow // At least one element cannot be consolidated. Get out.
        } else {
          mtext.children[0].text += childRow.children[j].children[0].text
        }
      }
    } else if (localVariant !== variant || mrow.children[i].type !== "mtext") {
      return mrow
    } else {
      mtext.children[0].text += mrow.children[i].children[0].text
    }
  }
  // Since we have gotten here, the text has been loaded into a single mtext node.
  // Next, consolidate the children into a single <mtext> element.
  mtext.children.splice(1, mtext.children.length - 1)
  // Firefox does not render a space at either end of an <mtext> string.
  // To get proper rendering, we replace leading or trailing spaces with no-break spaces.
  if (mtext.children[0].text.charAt(0) === " ") {
    mtext.children[0].text = "\u00a0" + mtext.children[0].text.slice(1)
  }
  const L = mtext.children[0].text.length
  if (L > 0 && mtext.children[0].text.charAt(L - 1) === " ") {
    mtext.children[0].text = mtext.children[0].text.slice(0, -1) + "\u00a0"
  }
  return mtext
}

export default {
  contains,
  deflt,
  escape,
  hyphenate,
  getBaseElem,
  isCharacterBox,
  protocolFromUrl,
  round,
  consolidateText
};

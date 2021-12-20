const fs = require("fs")  // Node.js file system
const hurmetMark = require("./hurmetMark.cjs")

let katexTests = fs.readFileSync('./test/katex-tests.md').toString('utf8')
// convert Markdown to HTML
katexTests = hurmetMark.hmd.md2html(katexTests, true)
fs.writeFileSync('./site/tests/katex-tests.html', katexTests)

let mhchemTests = fs.readFileSync('./test/mhchem-tests.md').toString('utf8')
mhchemTests = hurmetMark.hmd.md2html(mhchemTests, true)
fs.writeFileSync('./site/tests/mhchem-tests.html', mhchemTests)

let mozillaTests = fs.readFileSync('./test/mozilla-tests.md').toString('utf8')
mozillaTests = hurmetMark.hmd.md2html(mozillaTests, true)
fs.writeFileSync('./site/tests/mozilla-tests.html', mozillaTests)
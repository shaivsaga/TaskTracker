# 4. Plain JavaScript, no build step

**Decision.** The front end is plain HTML, CSS and JavaScript with no framework and no bundler.

**Why.** The project is small, and a deploy is just copying files. It also keeps the code readable for one maintainer.

**Cost.** `app.js` grew large as one script; it was split into `js/` modules with tests in ADR 6. A framework such as React is only worth considering as a separate learning branch.

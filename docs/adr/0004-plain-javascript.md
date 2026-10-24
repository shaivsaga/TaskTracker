# 4. Plain JavaScript, no build step

**Decision.** The front end is plain HTML, CSS and JavaScript with no framework and no bundler.

**Why.** The project is small, and a deploy is just copying files. It also keeps the code readable for one maintainer.

**Cost.** `app.js` is large and loads as one script. Splitting it and adding tests is planned as a later step. A framework such as React is only worth considering as a separate learning branch.

# 2. Draft and Board are separate

**Decision.** The President edits a private Draft in their browser. Publish replaces the public Board (`data/current.json`) with it. Each publish also saves a Version.

**Why.** Half-finished edits never reach the class, and a mistaken publish can be undone from History.

**Cost.** The Draft lives in one browser, so it is lost if that browser's data is cleared. Checkpoints and Versions reduce the risk.

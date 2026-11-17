# Project Rules

- **Commit but No Push**: Every time file modifications are completed, stage the changes and perform a `git commit` with a descriptive message. **DO NOT** run `git push` unless the user explicitly requests it.
- **Bump Version on Push**: Whenever the user explicitly requests a `git push`, you MUST bump the version according to Semantic Versioning (SemVer) based on the nature of the commits being pushed (patch for bug fixes/minor adjustments, minor for new features, major for breaking changes). Update the version across all relevant places (e.g. `package.json` and the version display in `store.html`), commit the version bump, and only then proceed with `git push`.
- **"ship" means release to main**: When the user types `ship` after a change is finished, do the whole release without asking again, in this order:
  1. **Check for bugs on PC and mobile**: run the changed pages in a real browser at a desktop viewport and at a phone viewport, exercise the flows the change touches, and fix what breaks. If a check fails and cannot be fixed, stop and report instead of releasing.
  2. **Commit** any remaining changes, then bump the version as described in "Bump Version on Push".
  3. **Push** the branch and open a **pull request** into `main`.
  4. **Wait for CI** on the pull request. Release only when it is green; if it fails, fix it or stop and report. If the repository has no CI checks, say so in the report and continue.
  5. **Merge the pull request into `main`.**
  The word `ship` is the explicit request for the push, the pull request and the merge. Without it, "Commit but No Push" still applies.

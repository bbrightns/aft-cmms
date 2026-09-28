# Project Rules

- **Commit but No Push**: Every time file modifications are completed, stage the changes and perform a `git commit` with a descriptive message. **DO NOT** run `git push` unless the user explicitly requests it.
- **Bump Version on Push**: Whenever the user explicitly requests a `git push`, you MUST bump the version according to Semantic Versioning (SemVer) based on the nature of the commits being pushed (patch for bug fixes/minor adjustments, minor for new features, major for breaking changes). Update the version across all relevant places (e.g. `package.json` and the version display in `store.html`), commit the version bump, and only then proceed with `git push`.

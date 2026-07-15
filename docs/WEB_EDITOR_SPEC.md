# Web Editor Specification

The tree editor is the default view over the same Manifest AST used by YAML and generation. Additional views are natural language, node graph, YAML, generated TypeScript, Custom Code, run results, and Git diff. Monaco handles code/YAML; React Flow handles conditional, loop, parallel, and race graph editing.

Edits validate before save, regenerate code, show source mappings and diffs, and default to a dedicated Git branch plus Pull Request. Direct commits require project policy and never target protected branches.

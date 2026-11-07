# Installing external UI/UX skill packs

When a build needs design intelligence beyond the bundled skills, pull these and wire them into the Hermes
skills directory. They install as plain `SKILL.md` folders — no runtime coupling.

## UI UX Pro Max (searchable design DB)

```bash
npm install -g ui-ux-pro-max-cli           # installs the `uipro` command
 uipro init --ai universal --global        # writes ~/.agents/skills/{ui-ux-pro-max,design,design-system,
                                           #   ui-styling,brand,banner-design,slides}
```

Query it from the shell when choosing a direction:

```bash
python3 ~/.hermes/skills/ui-ux-pro-max/scripts/search.py "saas dashboard dark"   # stdlib only, offline
```

## Impeccable (design vocabulary + anti-slop engine supports Hermes natively)

```bash
npx -y impeccable@latest install -y --providers=hermes --scope=global
~/.hermes/skills/impeccable/scripts/bin/linux-x64/impeccable --version
~/.hermes/skills/impeccable/scripts/bin/linux-x64/impeccable detect --list-rules
```

`detect <dir|url>` returns exit code 2 when it finds findings — useful as a pre-handover gate on a built app.

## open-design / curated subsets

Clone shallow, then symlink only the skills that fit the task into `~/.hermes/skills/<category>/`:

```bash
git clone --depth 1 https://github.com/nexu-io/open-design
ln -s "$PWD/open-design/skills/color-expert" ~/.hermes/skills/ui-design/color-expert
```

Linking every skill in a large pack floods the skills index — pick 5–7 topical ones (colour, motion,
tokens, platform rules) and skip the rest.

## Rules

- `~/.agents/skills/*` is not on Hermes' load path: symlink each directory into `~/.hermes/skills/` so it
  appears as a normal skill.
- Verify after install by running the pack's own smoke command (search script, engine `--version`,
  `--list-rules`) — an installed-but-unrunnable pack is worse than none.
- Design packs inform the build; they never override the spec's palette, layout or scope constraints.

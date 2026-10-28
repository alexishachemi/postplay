# PostPlay

Local, post-session AI playtesting for Godot: record gameplay and telemetry,
analyze with Meta Muse Spark, and inspect the evidence in a local dashboard.
Implementation is starting; see [TASKS.md](TASKS.md) for verified progress and
[PROJECT.md](PROJECT.md) for the approved specification.

## Development environment

The Nix development shell targets **x86_64 Linux**, matching the owner-supplied
Godot package in `nix/godot.nix`. With Nix flakes enabled:

```sh
nix develop
godot --version
node --version
npm --version
ffmpeg -version
ffprobe -version
```

The flake provides the custom Godot editor, Node.js 24 with npm, FFmpeg/FFprobe,
Git, and nixfmt. `flake.lock` pins nixpkgs; the supplied Godot derivation pins
its upstream binary and hash. npm is the selected JavaScript package manager;
an application package and lockfile will be added during M0.2.

The custom Godot launcher uses an FHS environment and needs a host that permits
its sandbox/user-namespace setup. A headless version check does not demonstrate
interactive recording; Movie Maker feasibility is a separate M0 check.

Without Nix, the intended prerequisites are a compatible Godot 4.x editor,
Node.js 24 with npm, and FFmpeg/FFprobe on PATH. This path has not yet been
verified. Application launch instructions will follow implementation.

Keep `MODEL_API_KEY` in the local environment only. Never put credentials in
Nix expressions or Git. No model requests are made by entering the shell.
Dashboard packaging (`nix build` / `nix run`) and addon archives are not yet
implemented.

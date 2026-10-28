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
`app/package-lock.json` pins the application dependencies.

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

## Initial application skeletons

Inside `nix develop`, from the repository root:

```sh
npm --prefix app ci --ignore-scripts
npm --prefix app run check
npm --prefix app run build
npm --prefix app run dev
godot --editor --path demo
```

Open <http://127.0.0.1:4321>. The page describes the current implementation
status; session ingestion and analysis are not implemented yet. Astro 7 starts
its development server in the background; stop it from `app/` with
`npx astro dev stop`. The production server starts after a build with
`npm --prefix app start`, also bound to loopback by default.

The demo currently loads a placeholder scene and an enabled addon skeleton.
For a noninteractive parse/load check:

```sh
godot --headless --path demo --editor --import --quit
godot --headless --path demo --quit-after 2
```

Godot's `.godot/` cache, Node dependencies/build output, local sessions,
recordings and `.env` files are ignored. Keep generated GDScript `.uid` files
in Git to preserve resource identity. There is no model upload action yet.

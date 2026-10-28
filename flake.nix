{
  description = "PostPlay local Godot and Node development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      # The owner-supplied Godot package supports this platform.
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      godot = import ./nix/godot.nix nixpkgs;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          godot
          pkgs.nodejs_24
          pkgs.ffmpeg
          pkgs.git
          pkgs.just
          pkgs.nixfmt
        ];
      };
    };
}

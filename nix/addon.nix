{ pkgs }:
pkgs.runCommand "postplay-godot-addon"
  {
    nativeBuildInputs = [ pkgs.zip ];
    addonSource = ../demo/addons/postplay;
  }
  ''
    mkdir -p stage/addons/postplay "$out"
    cp -R "$addonSource"/. stage/addons/postplay/
    cd stage
    zip -X -r "$out/postplay-godot-addon.zip" addons
  ''

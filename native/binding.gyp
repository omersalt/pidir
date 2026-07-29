{
  "targets": [
    {
      "target_name": "glass",
      "sources": ["src/glass.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_DIALECT": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_LDFLAGS": ["-framework AppKit", "-framework QuartzCore"]
          }
        }]
      ]
    }
  ]
}

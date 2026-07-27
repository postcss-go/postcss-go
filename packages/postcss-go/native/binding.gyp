{
  "targets": [
    {
      "target_name": "postcss_go",
      "sources": ["addon.c"],
      "include_dirs": ["."],
      "libraries": ["<(module_root_dir)/go-out/libpostcssgo.a"],
      "cflags": ["-O2"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "OTHER_LDFLAGS": ["-framework", "CoreFoundation", "-framework", "Security"]
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "libraries+": ["-lpthread", "-ldl", "-lm"]
          }
        ]
      ]
    }
  ]
}

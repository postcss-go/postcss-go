{
  "targets": [
    {
      "target_name": "boundary",
      "sources": ["addon.c"],
      "include_dirs": ["go-out"],
      "libraries": ["<(module_root_dir)/go-out/libcore.a"],
      "cflags": ["-O2"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "OTHER_LDFLAGS": [
                "-framework", "CoreFoundation",
                "-framework", "Security"
              ]
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "libraries+": ["-lpthread", "-ldl", "-lresolv"]
          }
        ]
      ]
    }
  ]
}

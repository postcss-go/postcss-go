{
  "variables": {
    "postcss_go_shared%": 0
  },
  "targets": [
    {
      "target_name": "postcss_go",
      "sources": ["addon.c"],
      "include_dirs": ["."],
      "cflags": ["-O2", "-fvisibility=hidden"],
      "conditions": [
        [
          "postcss_go_shared==1",
          {
            "libraries": ["<(module_root_dir)/go-out/libpostcssgo.so"]
          },
          {
            "libraries": ["<(module_root_dir)/go-out/libpostcssgo.a"]
          }
        ],
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_SYMBOLS_PRIVATE_EXTERN": "YES",
              "OTHER_LDFLAGS": [
                "-framework",
                "CoreFoundation",
                "-framework",
                "Security",
                "-Wl,-exported_symbols_list,<(module_root_dir)/exports.darwin"
              ]
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "libraries+": ["-lpthread", "-ldl", "-lm"],
            "ldflags": [
              "-Wl,--version-script=<(module_root_dir)/exports.elf"
            ]
          }
        ],
        [
          "OS=='linux' and postcss_go_shared==1",
          {
            "ldflags+": ["-Wl,-rpath,'$$ORIGIN'"]
          }
        ],
        [
          "OS=='win'",
          {
            "libraries+": [
              "ntdll.lib",
              "ws2_32.lib",
              "winmm.lib",
              "userenv.lib",
              "bcrypt.lib",
              "advapi32.lib"
            ]
          }
        ]
      ]
    }
  ]
}

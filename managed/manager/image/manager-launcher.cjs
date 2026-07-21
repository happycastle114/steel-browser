#!/usr/local/bin/node
"use strict"

import("/app/managed/manager/build/cli.js")
  .then(({ main }) => main(process.argv.slice(2)))
  .catch(() => {
    process.stderr.write("steel managed manager startup failed\n")
    process.exitCode = 1
  })

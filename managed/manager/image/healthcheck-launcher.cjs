#!/usr/local/bin/node
"use strict"

import("/app/managed/manager/build/healthcheck-cli.js")
  .then(({ main }) => main(process.argv.slice(2)))
  .catch(() => {
    process.exitCode = 1
  })

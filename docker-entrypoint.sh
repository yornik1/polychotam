#!/bin/sh
set -e
# Схема до старта Nest (onModuleInit не должен опережать миграции)
node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js
exec node dist/main.js

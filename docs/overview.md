# Zoonotify

Bilingual (English/German) zoonotic-disease surveillance platform for BfR Germany. This is a
monorepo of three parts:

| Folder                                        | What it is                                   | Stack                  |
| --------------------------------------------- | -------------------------------------------- | ---------------------- |
| [`zoonotify-client/`](../../zoonotify-client) | Web app (the public site)                    | React 18 + TypeScript  |
| [`zoonotify-cms/`](../../zoonotify-cms)       | Backend / content API                        | Strapi v5 + PostgreSQL |
| [`zoonotify-import/`](../)                    | CLI that bulk-loads survey data into the CMS | Node 20 + TypeScript   |

The client reads all its data from the CMS REST API. Content is stored in English and German and
the active language is kept in the URL as `?lang=de`.

## Run it locally

You need **Node 20+**. Start the two services in separate terminals:

```bash
# Terminal 1 — CMS (http://localhost:3000)
cd zoonotify-cms
yarn install
yarn develop

# Terminal 2 — Web client (http://localhost:8080)
cd zoonotify-client
npm install
npm start
```

Open <http://localhost:8080>. The client proxies API calls to the CMS automatically.

## Load data (import CLI)

To bulk-load the source workbook (`ZooNotify_DB.xlsx`) into the CMS:

```bash
cd zoonotify-import
npm ci
cp .env.example .env        # set STRAPI_URL + STRAPI_TOKEN
npm start -- --dry-run ./path/to/ZooNotify_DB.xlsx   # validate first
npm start -- ./path/to/ZooNotify_DB.xlsx             # then import
```

Full usage, flags, and the ops runbook live in the import CLI's
[`README.md`](../README.md) and [`runbook.md`](./runbook.md).

## More

- Each sub-package has its own `README.md` with detailed setup and conventions.
- Import domain language and decisions: [`CONTEXT.md`](../../CONTEXT.md) and
  [`docs/import-cli-spec/`](../../docs/import-cli-spec).

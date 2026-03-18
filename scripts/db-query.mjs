import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function loadLocalEnv() {
  const cwd = process.cwd();
  const envFiles = [".env.local", ".env"];

  for (const fileName of envFiles) {
    const fileValues = parseEnvFile(path.join(cwd, fileName));
    for (const [key, value] of Object.entries(fileValues)) {
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

function normalizeConnectionString(connectionString) {
  if (!connectionString) {
    return connectionString;
  }

  return connectionString.replace(/:\[([^\]]+)\]@/, ":$1@");
}

function getQueryFromArgs(args) {
  if (args.length === 0) {
    throw new Error("Provide a SQL query string or pass --file <path-to-sql>.");
  }

  if (args[0] === "--file") {
    const filePath = args[1];
    if (!filePath) {
      throw new Error("Missing path after --file.");
    }

    const resolvedPath = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(resolvedPath, "utf8");
  }

  return args.join(" ");
}

async function main() {
  loadLocalEnv();

  const connectionString = normalizeConnectionString(process.env.SUPABASE_DB_URL);
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is not set in the local environment.");
  }

  const queryText = getQueryFromArgs(process.argv.slice(2));
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await client.connect();

  try {
    const result = await client.query(queryText);
    const output = {
      rowCount: result.rowCount,
      rows: result.rows,
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

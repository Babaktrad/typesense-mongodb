import defaults from "./defaults";
import { config } from "./interfaces/config";
import { node } from "./interfaces/node";
import { MongoClient } from "./MongoClient";
import { TypesenseClient } from "./TypesenseClient";
import Listr from "listr";
import chalk from "chalk";
import { ChangeStreams } from "./ChangeStreams";

let typesense: TypesenseClient;
let mongo: MongoClient;
let need: boolean;

function typesenseURLParser(url: string): node {
  const splits = url.split(":");

  return {
    host: splits[1].slice(2, splits[1].length),
    port: splits[splits.length - 1],
    protocol: splits[0],
  };
}

async function initializeTypesenseClient(
  options: config
): Promise<TypesenseClient> {
  typesense = new TypesenseClient(options.typesenseKey, [
    typesenseURLParser(options.typesenseURL),
  ]);
  try {
    await typesense.checkServer();
  } catch (err) {
    console.error(err);
  }
  return typesense;
}

async function initializeMongoClient(options: config): Promise<MongoClient> {
  mongo = new MongoClient(options.mongodbURL);
  try {
    await mongo.connectMongo();
  } catch (err) {
    console.error(err);
  }
  return mongo;
}

async function checkForExistingCollection(
  typesense: TypesenseClient,
  options: config
): Promise<boolean> {
  need = await typesense.checkCollection(options.typesenseCollectionName);
  return need;
}

async function indexExistingDocuments(
  typesense: TypesenseClient,
  mongo: MongoClient,
  options: config
): Promise<void> {
  const document = await mongo.readDocuments(
    options.mongodbDatabaseName,
    options.mongodbCollectionName
  );
  await typesense.importDocuments(options.typesenseCollectionName, document);
}

function enableChangeStreams(
  typesense: TypesenseClient,
  mongo: MongoClient,
  options: config
): void {
  new ChangeStreams(
    mongo,
    typesense,
    options.mongodbDatabaseName,
    options.mongodbCollectionName,
    options.typesenseCollectionName
  );
}

export async function Main(parsed: config): Promise<void> {
  const options: config = {
    mongodbDatabaseName:
      parsed.mongodbDatabaseName || defaults.mongodbDatabaseName,
    mongodbCollectionName:
      parsed.mongodbCollectionName || defaults.mongodbCollectionName,
    mongodbURL: parsed.mongodbURL || defaults.mongodbURL,
    typesenseCollectionName:
      parsed.typesenseCollectionName || defaults.typesenseCollectionName,
    typesenseKey: parsed.typesenseKey || defaults.typesenseKey,
    typesenseURL: parsed.typesenseURL || defaults.typesenseURL,
  };

  const tasks = new Listr([
    {
      title: "Initialize Typesense Client",
      task: () => initializeTypesenseClient(options),
    },
    {
      title: "Initialize Mongo Client",
      task: () => initializeMongoClient(options),
    },
    {
      title: "Check for an existing typesense collection",
      task: () => checkForExistingCollection(typesense, options),
    },
    {
      title: "Create a new Typesense Collection",
      task: () => typesense.createCollection(options.typesenseCollectionName),
      skip: () => need
          ? "Found an existing collection skipping create collection"
          : undefined
    },
    {
      title: "Index existing documents",
      task: () => indexExistingDocuments(typesense, mongo, options),
    },
    {
      title: "Open Change Stream",
      task: () => enableChangeStreams(typesense, mongo, options),
    },
  ]);

  await tasks.run();
  console.log("%s Watching for changes..", chalk.green("DONE"));
}

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const packageDef = await protoLoader.load(path.join(__dirname, "greeter.proto"), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const grpcObject = grpc.loadPackageDefinition(packageDef);
const helloworld = grpcObject.helloworld;

function SayHello(call, callback) {
  const name = call.request.name || "World";
  const times = call.request.times || 1;
  const greeting = Array(times).fill(`Hello, ${name}!`).join(" ");
  callback(null, { message: greeting });
}

function SayBye(call, callback) {
  const name = call.request.name || "World";
  callback(null, { message: `Goodbye, ${name}!` });
}

const server = new grpc.Server();
server.addService(helloworld.Greeter.service, { SayHello, SayBye });

server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`gRPC Greeter server running on port ${port}`);
});

import type { BuildProfile } from "./types/index.js";

export const DEFAULT_BUILD_PROFILES: BuildProfile[] = [
  { name: "node", description: "Node.js (npm)", image: "node:22-alpine", command: "npm", args: ["run", "build"], env: {}, notes: "Uses npm. Set command/args to override." },
  { name: "python", description: "Python (pip + pytest)", image: "python:3.12-slim", command: "python", args: ["-m", "pytest"], env: {}, notes: "Install deps first via install endpoint." },
  { name: "rust", description: "Rust (cargo)", image: "rust:1.80-slim", command: "cargo", args: ["build", "--release"], env: {}, crossCompile: false, notes: "For cross-compile set CARGO_TARGET_* env." },
  { name: "go", description: "Go", image: "golang:1.23-alpine", command: "go", args: ["build", "./..."], env: { CGO_ENABLED: "0" }, crossCompile: true, notes: "Cross-compile via GOOS/GOARCH env." },
  { name: "cpp", description: "C/C++ (gcc)", image: "gcc:14", command: "make", args: [], env: {}, notes: "Requires Makefile." },
  { name: "java", description: "Java (maven)", image: "maven:3.9-eclipse-temurin-21", command: "mvn", args: ["-q", "package"], env: {} },
  { name: "android", description: "Android (gradle)", image: "reactnativecommunity/react-native-android", command: "./gradlew", args: ["assembleRelease"], env: {}, notes: "Heavy image; ensure VPS capacity." },
  { name: ".net", description: ".NET SDK", image: "mcr.microsoft.com/dotnet/sdk:8.0", command: "dotnet", args: ["build", "-c", "Release"], env: {} },
];

export function getProfile(name: string): BuildProfile | undefined {
  return DEFAULT_BUILD_PROFILES.find((p) => p.name === name);
}
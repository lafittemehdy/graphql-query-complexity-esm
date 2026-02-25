# Complexity Visualization Playground

An interactive React application that demonstrates `graphql-query-complexity-esm` in the browser. Write GraphQL queries, adjust the complexity limit, and watch the analysis engine break down field-level costs in real time.

**Live demo:** [lafittemehdy.github.io/graphql-query-complexity-esm](https://lafittemehdy.github.io/graphql-query-complexity-esm/)

## Features

- Real-time complexity analysis as you type
- Field-level cost breakdown with parent type context
- Animated scan sequence with per-field detail logging
- Adjustable complexity limit with adaptive stepping
- Preset queries ranging from simple to exponential
- Copy-to-clipboard install command

## Getting Started

```bash
# From the repository root
cd examples/visualization

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`.

## Building for Production

```bash
npm run build
npm run preview
```

## Tech Stack

- **React 19** with TypeScript
- **Vite** for bundling and dev server
- **graphql** + `graphql-query-complexity-esm` for analysis
- **Biome** for linting and formatting (extends root config)

if (
  process.execArgv.length !== 1 ||
  process.execArgv[0] !== "--preserve-symlinks-main" ||
  process.env.NODE_OPTIONS ||
  process.argv.length !== 2
) {
  throw new Error(
    "Accounting release preflight requires exactly Node --preserve-symlinks-main, no NODE_OPTIONS, and no arguments",
  );
}

const { runPreflight } = await import("./accounting release preflight core.mjs");
runPreflight({ requireCommitted: true });

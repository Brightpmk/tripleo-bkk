import { hash } from "bcryptjs";
import { stdin, stdout } from "node:process";

if (!stdin.isTTY) {
  console.error("Run this command in an interactive terminal.");
  process.exitCode = 1;
} else {
  const password = await readHiddenPassword("Admin password: ");
  const confirmation = await readHiddenPassword("Confirm password: ");

  if (password.length < 12) {
    console.error("Use an admin password with at least 12 characters.");
    process.exitCode = 1;
  } else if (password !== confirmation) {
    console.error("Passwords do not match.");
    process.exitCode = 1;
  } else {
    const passwordHash = await hash(password, 12);
    console.log("\nADMIN_PASSWORD_HASH=" + passwordHash);
  }
}

function readHiddenPassword(prompt) {
  return new Promise((resolve) => {
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (input) => {
      for (const character of input) {
        if (character === "\u0003") {
          cleanup();
          process.exit(130);
        }

        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }

        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };

    function cleanup() {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.on("data", onData);
  });
}

---
name: echo
description: Writes the task parameters to result.txt in the working directory and replies with done.
---

# Echo

You receive task parameters as a JSON object (keyed by field id) in the user
message. Perform exactly these steps:

1. Read the `message` parameter. If the `uppercase` parameter is `true`,
   convert the message to uppercase.
2. Write the (possibly uppercased) message into a file named `result.txt` in
   the current working directory, overwriting it if it exists.
3. Reply with exactly one word: `done`

Do not run any other commands, do not access the network, and do not write any
other files.

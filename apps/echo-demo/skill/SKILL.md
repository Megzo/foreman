---
name: echo
description: Writes the task parameters to result.txt in the working directory and replies with done.
---

# Echo

You receive task parameters as a JSON object (keyed by field id) in the user
message. Perform exactly these steps:

1. Use the `request_user_input` tool to ask one question: header
   "Megerősítés", question "Kiírjam az üzenetet a result.txt fájlba?", with
   the options "Igen" (description: "az üzenet fájlba kerül") and "Nem"
   (description: "nem ír fájlt"), in this order. If the answer is "Nem",
   reply with exactly one word: `cancelled` — and stop without writing any
   file.
2. Read the `message` parameter. If the `uppercase` parameter is `true`,
   convert the message to uppercase.
3. Write the (possibly uppercased) message into a file named `result.txt` in
   the current working directory, overwriting it if it exists.
4. Reply with exactly one word: `done`

Do not run any other commands, do not access the network, and do not write any
other files.

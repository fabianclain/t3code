# Tasks

The desktop app's **Tasks** panel shows the work items in your Plane instance. T3 Code talks to
Plane through the server that holds the connection, so the tasks you see are the ones in that
Plane workspace.

## Connect Plane

Open **Settings → Plane** in the desktop app and fill in:

- **Plane URL**: the address of your Plane instance, for example `https://plane.example.com`. A
  full workspace link such as `https://plane.example.com/my-workspace` works too.
- **Workspace**: the workspace slug, for example `my-workspace`. It is required when the Plane URL
  is only the instance address; a URL that already names the workspace fills it in for you.
- **API token**: a personal API token from your Plane account. The server keeps it in its secret
  store, uses it to authenticate to Plane, and never sends it back to a connected client.

The connection belongs to one server, so configure it on the server that owns the workspace you
work in. Choose **Save**, then **Test connection** to check that the server reaches Plane and
that the token works. The server makes every request, so the machine running it has to reach the
instance over your local network or Tailscale.

**Remove** clears the connection and the stored token from that server. The token stays as it was
when you change the URL or the workspace and leave the token field empty.

## Work with tasks

- A note is an ordinary task. Choose a project in the panel, then **New task** creates it in
  Plane without leaving T3 Code. From the task you can **Edit** its fields and **Add comment**,
  and tasks you create in Plane show up in the same list.
- Copying a task into a chat is manual: use the copy action on a task and paste it into the
  composer. T3 Code does not attach tasks to threads on its own.
- Search asks Plane for the matching tasks and returns a capped set of matches. When that cap is
  reached, narrowing the query is what brings the specific task you want into view.
- Filters narrow the tasks T3 Code has loaded, not the whole project. **Load more tasks** pulls in
  the rest.

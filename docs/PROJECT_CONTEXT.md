# Project context

Open a saved data app in Builder and expand **Project context**. Record the goal, architecture, preferences, dependencies, and open problems. Add decisions and tasks as the project develops. **Replace** saves a new decision and marks the old one superseded. Tasks can be completed, cancelled, or reopened. **Recent changes** shows the five latest saved application revisions. Restoring the application leaves its current context intact.

The selected application's owner can read and update context. A version check protects concurrent changes between tabs, while each plan also carries its context version. If context changes while a plan is being generated or before it is applied, start a fresh plan. Updating context does not run a build.

When the Builder calls its model provider for an application plan or refinement, it includes the active notes, decisions, and tasks along with the existing manifest and the current request. Superseded decisions, closed tasks, records, and raw revision prompts stay out of model calls. Keep credentials and customer data out of planning notes. Prepared builds still work when a provider is unavailable.

Each project stores five 300-character notes and up to 20 decisions and 20 tasks. New entries can replace the oldest inactive entry once a list is full. Project context is kept in the private application database and backups. Deleting the application deletes its context.

Context is available for signed-in data apps. It is edited by the owner and feeds the current manifest-based Builder. Recording or cancelling a task changes the project context. It does not schedule or stop background execution.

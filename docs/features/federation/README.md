# ActivityPub federation

When federation is enabled, a public Community profile can display an address that readers follow from another ActivityPub server.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Find an author | The local profile exposes a federated address. A remote reader enters that address in their own application to find and follow the author. | WebFinger resolves the handle to a stable actor identifier. Incoming Follow and Undo Follow update remote follower state. The local Following tab manages its own relationships. |
| Receive activity | Remote followers can see eligible articles, posts, reflections, replies and reactions. Writing is represented as a Note. Likes and reposts are activities. | A worker reconciles published database state, filters by public author and source visibility, and delivers eligible activity. The local Community feed does not import remote posts or discussions. |
| Edit, hide or withdraw | Updates can change a previously visible remote object. Withdrawal can produce Delete or Undo. The recipient’s server controls its own copy. | An object keeps its identity through edits. A publication after processed deletion receives a new identity. Object reads and delivery both recheck visibility. A profile change can therefore retract earlier activity. |

## Following a request

A person who wants to follow from another server uses the address on the public profile. Someone who follows on the website uses the Community relationship control. A reader can use both independently, and the delivery status of one tells you little about the other.

## Implementation and related reading

- WebFinger, actors, outbox, objects and inbox. [routes/activitypub.js](../../../routes/activitypub.js)
- Source eligibility and public object data. [lib/ActivityPubSources.js](../../../lib/ActivityPubSources.js)
- Reconciliation and delivery. [lib/ActivityPubWorker.js](../../../lib/ActivityPubWorker.js)
- Activation, privacy and delivery operations. [ACTIVITYPUB.md](../../../ACTIVITYPUB.md)

[All features](../README.md)

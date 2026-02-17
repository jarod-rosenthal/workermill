/**
 * Worker shim — imports the remote bootstrap entry point.
 * Used when the binary is invoked with __WORKERMILL_MODE=worker.
 */
import "../../worker/epic/remote-bootstrap.js";

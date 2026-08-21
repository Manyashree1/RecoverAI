const { RECOVERY_ACTION_STATUS } = require('../constants/enums');

const ALLOWED = Object.freeze({
  [RECOVERY_ACTION_STATUS.POLICY_ALLOWED]: [RECOVERY_ACTION_STATUS.EXECUTING, RECOVERY_ACTION_STATUS.BLOCKED],
  [RECOVERY_ACTION_STATUS.EXECUTING]: [RECOVERY_ACTION_STATUS.EXECUTED, RECOVERY_ACTION_STATUS.FAILED]
});

function canTransitionAction(from, to) {
  return ALLOWED[from]?.includes(to) === true;
}

module.exports = { canTransitionAction };

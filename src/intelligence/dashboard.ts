export const workflowGroups = [
  {
    title: 'Investigate and repair',
    description: 'Start with a failure or reproduce a difficult condition.',
    ids: ['investigateFailures', 'openScenarioLab', 'verifyRepair', 'testTheTests'],
  },
  {
    title: 'Understand test coverage',
    description: 'Explore your tests and decide what to run next.',
    ids: ['showBehaviorMap', 'showChangeRadar', 'managePromises'],
  },
  {
    title: 'Advanced experiments',
    description: 'Configure adapters, controls or recorded incidents for these workflows.',
    ids: [
      'openBugCapsules',
      'branchFailure',
      'checkProductLaws',
      'benchmarkJourneys',
      'openAgentWindTunnel',
      'challengeRepair',
      'showBehaviorDiff',
      'openIncidentMemory',
    ],
    advanced: true,
  },
];
export const prerequisites: Record<string, string> = {
  investigateFailures: 'Needs a captured test run',
  openScenarioLab: 'Create a scenario, then select tests',
  verifyRepair: 'Open a failing test and choose a candidate file',
  testTheTests: 'Needs tests and editable application sources',
  showBehaviorMap: 'Reads local test sources',
  showChangeRadar: 'Needs a Git repository with a commit',
  managePromises: 'Link requirements to existing tests',
  openBugCapsules: 'Capture a reproduced failure or import a capsule',
  branchFailure: 'Needs a configured journey checkpoint',
  checkProductLaws: 'Needs a product-law adapter',
  benchmarkJourneys: 'Needs scripted and agent test adapters',
  openAgentWindTunnel: 'Needs an agent adapter and model labels',
  challengeRepair: 'Needs a candidate repair and negative controls',
  showBehaviorDiff: 'Needs a Git revision and observable test output',
  openIncidentMemory: 'Create an incident and link a regression test',
};

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

const API_BASE_URL = 'https://canvas.du.edu/api/v1';
const API_KEY_PATH = path.join(__dirname, 'api_key.txt');
const SCRIPT_PATH = __filename;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getSubmissionTarget() {
  const courseId = process.env.CANVAS_COURSE_ID || process.argv[2];
  const assignmentId = process.env.CANVAS_ASSIGNMENT_ID || process.argv[3];

  if (!courseId || !assignmentId) {
    throw new Error(
      'Missing course or assignment ID. Provide CANVAS_COURSE_ID and CANVAS_ASSIGNMENT_ID, or pass <courseId> <assignmentId> as arguments.'
    );
  }

  return { courseId, assignmentId };
}

async function loadApiKey() {
  const apiKey = (await fs.readFile(API_KEY_PATH, 'utf8')).trim();

  if (!apiKey) {
    throw new Error('API key file is empty.');
  }

  return apiKey;
}

function buildCanvasClient(apiKey) {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 15000
  });
}

async function buildSubmissionBody() {
  const scriptContents = await fs.readFile(SCRIPT_PATH, 'utf8');
  return `<pre>${escapeHtml(scriptContents)}</pre>`;
}

async function getAssignmentDetails(canvasApi, courseId, assignmentId) {
  const response = await canvasApi.get(
    `/courses/${courseId}/assignments/${assignmentId}`
  );

  return response.data;
}

function validateAssignment(assignment) {
  if (!assignment.submission_types.includes('online_text_entry')) {
    throw new Error(
      `Assignment does not accept online_text_entry submissions. Allowed types: ${assignment.submission_types.join(', ')}`
    );
  }

  if (assignment.locked_for_user) {
    throw new Error(
      `Assignment is locked for this user. Due at: ${assignment.due_at || 'n/a'}, lock at: ${assignment.lock_at || 'n/a'}.`
    );
  }
}

async function submitAssignment(canvasApi, courseId, assignmentId, body) {
  const payload = new URLSearchParams({
    'submission[submission_type]': 'online_text_entry',
    'submission[body]': body
  });

  return canvasApi.post(
    `/courses/${courseId}/assignments/${assignmentId}/submissions`,
    payload.toString()
  );
}

function logHttpError(error) {
  if (error.response) {
    console.error(`Canvas API request failed with status ${error.response.status}.`);
    console.error(error.response.data);
    return;
  }

  if (error.request) {
    console.error('Canvas API request was sent but no response was received.');
    return;
  }

  console.error(`Request setup failed: ${error.message}`);
}

async function main() {
  try {
    const { courseId, assignmentId } = getSubmissionTarget();
    const apiKey = await loadApiKey();
    const canvasApi = buildCanvasClient(apiKey);
    const assignment = await getAssignmentDetails(canvasApi, courseId, assignmentId);
    const submissionBody = await buildSubmissionBody();

    validateAssignment(assignment);

    const userResponse = await canvasApi.get('/users/self');
    console.log(`Authenticated as ${userResponse.data.name} (${userResponse.data.id}).`);

    const submissionResponse = await submitAssignment(
      canvasApi,
      courseId,
      assignmentId,
      submissionBody
    );

    console.log('Submission created successfully.');
    console.log({
      courseId,
      assignmentId,
      submissionId: submissionResponse.data.id,
      submittedAt: submissionResponse.data.submitted_at,
      submissionType: submissionResponse.data.submission_type
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logHttpError(error);
    } else {
      console.error(`Error: ${error.message}`);
    }

    process.exitCode = 1;
  }
}

main();
import {
  API_URL,
  logout,
  populateUserSummary,
  readJson,
  requireElement,
  requireRole,
  type ApiError
} from '../shared';

interface UploadResponse extends ApiError {
  filename: string;
  imageUrl: string;
}

interface CreateRecordResponse extends ApiError {
  message: string;
  recordId: number;
}

const session = requireRole('student', '../login.html');

if (session) {
  const logoutButton = requireElement<HTMLButtonElement>('#logout-button');
  const form = requireElement<HTMLFormElement>('#upload-form');
  const imageUpload = requireElement<HTMLElement>('#image-upload');
  const imageInput = requireElement<HTMLInputElement>('#image-input');
  const imagePreview = requireElement<HTMLImageElement>('#image-preview');
  const uploadPlaceholder = requireElement<HTMLElement>('#upload-placeholder');
  const practiceDateInput = requireElement<HTMLInputElement>('#practice_date');
  const submitButton = requireElement<HTMLButtonElement>('#submit-btn');
  const titleInput = requireElement<HTMLInputElement>('#title');
  const contentInput = requireElement<HTMLTextAreaElement>('#content');
  const locationInput = requireElement<HTMLInputElement>('#location');
  const durationInput = requireElement<HTMLInputElement>('#duration');
  const errorMessage = requireElement<HTMLElement>('#error-message');
  const successMessage = requireElement<HTMLElement>('#success-message');

  let selectedImage: File | null = null;

  populateUserSummary('#user-name', '#user-avatar', session.user);
  logoutButton.addEventListener('click', () => logout('../login.html'));

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;
  practiceDateInput.valueAsDate = new Date();
  practiceDateInput.max = today;

  imageUpload.addEventListener('click', () => imageInput.click());
  imageUpload.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      imageInput.click();
    }
  });
  imageInput.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    selectedImage = input.files?.[0] ?? null;

    if (!selectedImage) {
      resetImagePreview(imagePreview, uploadPlaceholder, imageUpload);
      return;
    }

    if (selectedImage.size > 5 * 1024 * 1024) {
      showError(errorMessage, successMessage, '图片大小不能超过 5MB。');
      input.value = '';
      selectedImage = null;
      resetImagePreview(imagePreview, uploadPlaceholder, imageUpload);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      imagePreview.src = typeof reader.result === 'string' ? reader.result : '';
      imagePreview.style.display = 'block';
      uploadPlaceholder.style.display = 'none';
      imageUpload.classList.add('has-image');
    };
    reader.readAsDataURL(selectedImage);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideMessages(errorMessage, successMessage);

    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="loading"></span> 提交中...';

    try {
      let imagePath: string | null = null;

      if (selectedImage) {
        const formData = new FormData();
        formData.append('image', selectedImage);

        const uploadResponse = await fetch(`${API_URL}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` },
          body: formData
        });

        if (uploadResponse.status === 401) {
          logout('../login.html');
          return;
        }

        const uploadData = await readJson<UploadResponse>(uploadResponse);

        if (!uploadResponse.ok || !uploadData) {
          throw new Error(uploadData?.error ?? '图片上传失败。');
        }

        imagePath = uploadData.imageUrl;
      }

      const response = await fetch(`${API_URL}/student/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({
          title: titleInput.value.trim(),
          content: contentInput.value.trim(),
          practice_date: practiceDateInput.value,
          location: locationInput.value.trim() || null,
          duration: durationInput.value ? Number(durationInput.value) : null,
          image_path: imagePath
        })
      });

      if (response.status === 401) {
        logout('../login.html');
        return;
      }

      const data = await readJson<CreateRecordResponse>(response);

      if (!response.ok || !data) {
        throw new Error(data?.error ?? '提交记录失败。');
      }

      showSuccess(errorMessage, successMessage, '记录提交成功。');
      form.reset();
      resetImagePreview(imagePreview, uploadPlaceholder, imageUpload);
      imageInput.value = '';
      selectedImage = null;
      practiceDateInput.valueAsDate = new Date();

      window.setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交记录失败。';
      showError(errorMessage, successMessage, message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = '提交记录';
    }
  });
}

function hideMessages(errorMessage: HTMLElement, successMessage: HTMLElement): void {
  errorMessage.classList.remove('show');
  successMessage.style.display = 'none';
}

function showError(errorMessage: HTMLElement, successMessage: HTMLElement, message: string): void {
  successMessage.style.display = 'none';
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function showSuccess(errorMessage: HTMLElement, successMessage: HTMLElement, message: string): void {
  errorMessage.classList.remove('show');
  successMessage.textContent = message;
  successMessage.style.display = 'block';
}

function resetImagePreview(
  imagePreview: HTMLImageElement,
  uploadPlaceholder: HTMLElement,
  imageUpload: HTMLElement
): void {
  imagePreview.removeAttribute('src');
  imagePreview.style.display = 'none';
  uploadPlaceholder.style.display = 'block';
  imageUpload.classList.remove('has-image');
}

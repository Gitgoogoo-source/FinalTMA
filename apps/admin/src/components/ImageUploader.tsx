import { Image as ImageIcon, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";

import {
  signAdminStoragePreview,
  signAdminStorageUpload,
  uploadFileToSignedUrl,
} from "../admin.api";
import type {
  AdminStorageSignedUpload,
  AdminStorageTargetBucket,
} from "../admin.types";

type ImageUploaderProps = {
  label: string;
  targetBucket: AdminStorageTargetBucket;
  disabled?: boolean;
  previewUrl?: string | null;
  onUploaded: (upload: AdminStorageSignedUpload) => void;
  onError: (message: string) => void;
};

export function ImageUploader({
  label,
  targetBucket,
  disabled = false,
  previewUrl,
  onUploaded,
  onError,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileLabel, setFileLabel] = useState<string | null>(null);

  async function uploadSelectedFile(file: File) {
    setUploading(true);
    setFileLabel(file.name);

    try {
      const signed = await signAdminStorageUpload({
        targetBucket,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      await uploadFileToSignedUrl({
        signedUrl: signed.signedUrl,
        file,
      });
      const preview = await signAdminStoragePreview({
        targetBucket,
        tempPath: signed.tempPath,
      });

      onUploaded({
        ...signed,
        previewUrl: preview.previewUrl,
        previewExpiresAt: preview.previewExpiresAt,
      });
    } catch (error) {
      onError(readUploadError(error));
      setFileLabel(null);
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <div className="image-uploader">
      <div className="image-uploader__preview">
        {previewUrl ? (
          <img alt={label} src={previewUrl} />
        ) : (
          <span>
            <ImageIcon aria-hidden="true" size={20} />
          </span>
        )}
      </div>
      <div className="image-uploader__body">
        <strong>{label}</strong>
        <small>
          {fileLabel
            ? `${fileLabel}${uploading ? " / 上传中" : " / 待发布"}`
            : `${targetBucket} / admin-temp`}
        </small>
        <input
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={disabled || uploading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];

            if (file) {
              void uploadSelectedFile(file);
            }
          }}
          ref={inputRef}
          type="file"
        />
        <button
          className="icon-button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          <UploadCloud aria-hidden="true" size={16} />
          <span>{uploading ? "上传中" : "上传素材"}</span>
        </button>
      </div>
    </div>
  );
}

function readUploadError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "素材上传失败";
}

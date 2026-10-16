import { useState } from 'react';
import { Check, ImagePlus } from 'lucide-react';
import { useNavigate } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { useContent } from '../useContent';
import { pictures } from '../fixtures';

export default function CoverPage() {
  const { cover, setCover } = useContent();
  const [selected, setSelected] = useState(cover);
  const navigate = useNavigate();
  const notify = useToast();
  function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 2_500_000) {
      notify('请选择小于 2.5 MB 的图片');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSelected(String(reader.result));
    reader.onerror = () => notify('读取失败，请重新选择');
    reader.readAsDataURL(file);
  }
  return (
    <>
      <PageHeader
        title="动态封面"
        backTo={paths.moments}
        action={
          <button
            className="text-primary"
            onClick={() => {
              setCover(selected);
              notify('封面已更新');
              navigate(paths.moments, { replace: true });
            }}
          >
            完成
          </button>
        }
      />
      <div className="content-page">
        <img className="cover-preview" src={selected} alt="封面预览" />
        <h3>选择一张喜欢的风景</h3>
        <div className="cover-options">
          {Object.values(pictures).map((image) => (
            <button
              className={selected === image ? 'selected' : ''}
              key={image}
              aria-label={`选择封面 ${Object.values(pictures).indexOf(image) + 1}`}
              onClick={() => setSelected(image)}
            >
              <img src={image} alt="风景封面" />
              {selected === image && <Check />}
            </button>
          ))}
        </div>
        <label className="primary content-upload">
          <ImagePlus size={19} />
          从相册选择
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => upload(event.target.files?.[0])}
          />
        </label>
      </div>
    </>
  );
}

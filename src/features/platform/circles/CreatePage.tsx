import { useRef } from 'react';
import { useNavigate } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { circlesApi } from './api';
import CircleForm from './CircleForm';
import { circlePaths } from './paths';
import { useMutation } from './useMutation';
import { AuthGate } from './Ui';
export default function CreatePage() {
  return (
    <AuthGate title="创建圈子">
      <Create />
    </AuthGate>
  );
}
function Create() {
  const mutation = useMutation(),
    navigate = useNavigate();
  const pending = useRef({ payload: '', clientId: '' });
  return (
    <section className="platform-page sc-page">
      <PageHeader title="创建圈子" backTo={circlePaths.list} />
      <div className="sc-content">
        <CircleForm
          busy={mutation.busy}
          error={mutation.error}
          label="创建圈子"
          submit={async (input) => {
            const payload = JSON.stringify(input);
            if (pending.current.payload !== payload)
              pending.current = { payload, clientId: crypto.randomUUID() };
            const circle = await mutation.run((signal) =>
              circlesApi.create({ ...input, clientId: pending.current.clientId }, signal),
            );
            if (circle) navigate(circlePaths.home(circle.id), { replace: true });
          }}
        />
      </div>
    </section>
  );
}

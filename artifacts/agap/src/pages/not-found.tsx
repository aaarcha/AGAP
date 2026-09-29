import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex-1 w-full flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm mx-4 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="h-6 w-6 text-red-600" />
          <h1 className="text-xl font-black uppercase tracking-widest text-slate-900">
            404 Not Found
          </h1>
        </div>
        <p className="text-sm font-medium text-slate-500">
          The requested page could not be found.
        </p>
      </div>
    </div>
  );
}

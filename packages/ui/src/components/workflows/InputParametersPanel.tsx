import { Settings, X, Plus, Trash2 } from '../icons';

export interface InputParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  defaultValue?: string;
  description?: string;
}

interface InputParametersPanelProps {
  parameters: InputParameter[];
  onChange: (params: InputParameter[]) => void;
  onClose: () => void;
}

const INPUT_CLS =
  'w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary';

const SELECT_CLS =
  'w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function InputParametersPanel({
  parameters,
  onChange,
  onClose,
}: InputParametersPanelProps) {
  const handleAddParameter = () => {
    const newParam: InputParameter = {
      name: '',
      type: 'string',
      required: false,
    };
    onChange([...parameters, newParam]);
  };

  const handleRemoveParameter = (index: number) => {
    onChange(parameters.filter((_, i) => i !== index));
  };

  const handleUpdateParameter = (
    index: number,
    field: keyof InputParameter,
    value: string | boolean
  ) => {
    const updated = [...parameters];
    const existing = updated[index];
    if (!existing) return;
    updated[index] = { ...existing, [field]: value };
    onChange(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-4xl max-h-[80vh] bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg shadow-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-text-primary dark:text-dark-text-primary" />
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Input Parameters
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-primary dark:hover:bg-dark-bg-primary rounded"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-text-muted dark:text-dark-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary mb-4">
            Reference inputs in nodes as{' '}
            <code className="px-1.5 py-0.5 bg-bg-primary dark:bg-dark-bg-primary rounded text-xs">
              {'{{inputs.paramName}}'}
            </code>
          </p>

          {parameters.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-muted dark:text-dark-text-muted mb-4">
                No input parameters defined yet
              </p>
              <button
                onClick={handleAddParameter}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Parameter
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {parameters.map((param, index) => (
                <div
                  key={index}
                  className="p-4 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md"
                >
                  <div className="flex items-start gap-4">
                    {/* Parameter fields */}
                    <div className="flex-1 grid grid-cols-2 gap-4">
                      {/* Name */}
                      <div>
                        <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                          Name
                        </label>
                        <input
                          type="text"
                          value={param.name}
                          onChange={(e) =>
                            handleUpdateParameter(index, 'name', e.target.value)
                          }
                          placeholder="paramName"
                          className={INPUT_CLS}
                        />
                      </div>

                      {/* Type */}
                      <div>
                        <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                          Type
                        </label>
                        <select
                          value={param.type}
                          onChange={(e) =>
                            handleUpdateParameter(index, 'type', e.target.value)
                          }
                          className={SELECT_CLS}
                        >
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="boolean">Boolean</option>
                          <option value="json">JSON</option>
                        </select>
                      </div>

                      {/* Default Value */}
                      <div>
                        <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                          Default Value
                        </label>
                        <input
                          type="text"
                          value={param.defaultValue || ''}
                          onChange={(e) =>
                            handleUpdateParameter(
                              index,
                              'defaultValue',
                              e.target.value
                            )
                          }
                          placeholder="Optional"
                          className={INPUT_CLS}
                        />
                      </div>

                      {/* Required checkbox */}
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 pb-2">
                          <input
                            type="checkbox"
                            checked={param.required}
                            onChange={(e) =>
                              handleUpdateParameter(
                                index,
                                'required',
                                e.target.checked
                              )
                            }
                            className="w-4 h-4 text-primary border-border dark:border-dark-border rounded focus:ring-1 focus:ring-primary"
                          />
                          <span className="text-sm text-text-primary dark:text-dark-text-primary">
                            Required
                          </span>
                        </label>
                      </div>

                      {/* Description */}
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                          Description
                        </label>
                        <input
                          type="text"
                          value={param.description || ''}
                          onChange={(e) =>
                            handleUpdateParameter(
                              index,
                              'description',
                              e.target.value
                            )
                          }
                          placeholder="Optional description"
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>

                    {/* Remove button */}
                    <button
                      onClick={() => handleRemoveParameter(index)}
                      className="p-2 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded transition-colors mt-6"
                      aria-label="Remove parameter"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Add button when there are existing parameters */}
              <button
                onClick={handleAddParameter}
                className="w-full py-2 border border-dashed border-border dark:border-dark-border rounded-md text-sm text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:border-primary transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Parameter
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border dark:border-dark-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-dark transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

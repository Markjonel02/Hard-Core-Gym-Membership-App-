import { useField } from 'formik';
import { forwardRef } from 'react';
import type { TextInput, TextInputProps } from 'react-native';

import { Input } from '@/components/ui/Input';

type FormikFieldProps = TextInputProps & {
  /** Must match the key in the Formik `initialValues` object. */
  name: string;
  label?: string;
  hint?: string;
};

/**
 * An <Input> bound to Formik by field name.
 *
 * The error only renders once the field has been touched, so a form does not turn red
 * before anything has been typed — the user sees a mistake when they leave the field,
 * or on submit, which is when Formik marks everything touched.
 */
export const FormikField = forwardRef<TextInput, FormikFieldProps>(function FormikField(
  { name, ...rest },
  ref
) {
  const [field, meta, helpers] = useField<string>(name);
  const showError = meta.touched && Boolean(meta.error);

  return (
    <Input
      ref={ref}
      value={field.value}
      onChangeText={helpers.setValue}
      onBlur={() => helpers.setTouched(true)}
      error={showError ? meta.error : undefined}
      {...rest}
    />
  );
});

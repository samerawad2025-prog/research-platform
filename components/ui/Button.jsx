import styles from './Button.module.css';

export default function Button({ type = 'button', disabled, children, ...rest }) {
  return (
    <button type={type} disabled={disabled} className={styles.button} {...rest}>
      {children}
    </button>
  );
}
